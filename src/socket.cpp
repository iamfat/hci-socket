#include <errno.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <poll.h>
#include <uv.h>
#include <napi.h>

#define BTPROTO_HCI 1
#define HCI_MAX_DEV 16

#define HCI_CHANNEL_RAW     0
#define HCI_CHANNEL_USER    1
#define HCI_CHANNEL_CONTROL 3

#define HCI_MAX_FRAME_SIZE 1028

#define HCIDEVUP    _IOW('H', 201, int)
#define HCIDEVDOWN  _IOW('H', 202, int)
#define HCIDEVRESET _IOW('H', 203, int)
// #define HCIDEVRESTAT  _IOW('H', 204, int)
// #define HCIGETDEVLIST _IOR('H', 210, int)
#define HCIGETDEVINFO _IOR('H', 211, int)

enum {
    HCI_UP,
    HCI_INIT,
    HCI_RUNNING,

    HCI_PSCAN,
    HCI_ISCAN,
    HCI_AUTH,
    HCI_ENCRYPT,
    HCI_INQUIRY,

    HCI_RAW,
};

struct sockaddr_hci {
    sa_family_t hci_family;
    uint16_t    hci_dev;
    uint16_t    hci_channel;
};

struct hci_dev_info {
    uint16_t dev_id;
    char     name[8];

    uint8_t bdaddr[6];

    uint32_t flags;
    uint8_t  type;

    uint8_t features[8];

    uint32_t pkt_type;
    uint32_t link_policy;
    uint32_t link_mode;

    uint16_t acl_mtu;
    uint16_t acl_pkts;
    uint16_t sco_mtu;
    uint16_t sco_pkts;

    // hci_dev_stats
    uint32_t err_rx;
    uint32_t err_tx;
    uint32_t cmd_tx;
    uint32_t evt_rx;
    uint32_t acl_tx;
    uint32_t acl_rx;
    uint32_t sco_tx;
    uint32_t sco_rx;
    uint32_t byte_rx;
    uint32_t byte_tx;
};

class Socket : public Napi::ObjectWrap<Socket>
{
  public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    Socket(const Napi::CallbackInfo &info);
    ~Socket();

  private:
    Napi::Value Send(const Napi::CallbackInfo &info);
    Napi::Value Info(const Napi::CallbackInfo &info);
    void        Bind(const Napi::CallbackInfo &info);
    void        Close(const Napi::CallbackInfo &info);
    void        SetOpt(const Napi::CallbackInfo &info);
    void        Destroy();

    static void OnUVPoll(uv_poll_t *handle, int status, int events);

    int        sock;
    int        devId;
    uv_poll_t *uvPoll;
};

Socket::Socket(const Napi::CallbackInfo &info) : Napi::ObjectWrap<Socket>(info)
{
    auto env = info.Env();

    int sock = socket(AF_BLUETOOTH, SOCK_RAW, BTPROTO_HCI);
    if (sock < 0) {
        Napi::Error::New(env, "Unable to create HCI socket").ThrowAsJavaScriptException();
        return;
    }

    int devId = 0;
    if (info.Length() > 0) {
        if (!info[0].IsNumber()) {
            Napi::Error::New(env, "arg0 must be numbe!r").ThrowAsJavaScriptException();
            return;
        }
        devId = info[0].As<Napi::Number>();
    }

    this->uvPoll = nullptr;
    this->sock   = sock;
    this->devId  = devId;
}

Socket::~Socket() { Destroy(); }

void Socket::Destroy()
{
    if (this->uvPoll) {
        uv_poll_stop(this->uvPoll);
        uv_close((uv_handle_t *)this->uvPoll, (uv_close_cb)free);
        this->uvPoll = nullptr;
        this->Unref();
    }

    if (this->sock != -1) {
        close(this->sock);
        this->sock = -1;
    }
}

void Socket::OnUVPoll(uv_poll_t *handle, int status, int events)
{
    Socket *me = (Socket *)handle->data;

    auto              env = me->Env();
    Napi::HandleScope scope(env);
    // fprintf(stderr, "%p status %d events %d\n", me, status, events);

    // If the status is nonzero, on Linux it always corresponds to -EBADBF which
    // is manually set by libuv when POLLERR && !POLLPRI. In any case, just read
    // the socket to get the real error.

    uint8_t packet[HCI_MAX_FRAME_SIZE];
    ssize_t nbytes = read(me->sock, packet, HCI_MAX_FRAME_SIZE);
    if (nbytes <= 0) {
        me->Destroy();
    } else {
        auto buf  = Napi::Buffer<uint8_t>::Copy(env, packet, nbytes);
        auto This = me->Value();
        This.Get("emit").As<Napi::Function>().Call(
            This, {Napi::String::From(env, "data"), buf.Get("buffer")});
    }
    if (env.IsExceptionPending()) {
        napi_fatal_exception(env, env.GetAndClearPendingException().Value());
    }
}

void Socket::Bind(const Napi::CallbackInfo &info)
{
    auto env = info.Env();

    struct sockaddr_hci addr;
    addr.hci_family  = AF_BLUETOOTH;
    addr.hci_dev     = this->devId;
    addr.hci_channel = HCI_CHANNEL_USER;
    if (info.Length() == 1) {
        auto type = info[0].As<Napi::String>();
        if (type == Napi::String::From(env, "raw")) {
            addr.hci_channel = HCI_CHANNEL_RAW;
        } else if (type == Napi::String::From(env, "control")) {
            addr.hci_channel = HCI_CHANNEL_CONTROL;
        } else if (type == Napi::String::From(env, "user")) {
            addr.hci_channel = HCI_CHANNEL_USER;
        } else {
            Napi::Error::New(env, "Invalid bind mode").ThrowAsJavaScriptException();
            return;
        }
    }

    if (bind(this->sock, (struct sockaddr *)&addr, sizeof(addr)) == -1) {
        Napi::Error::New(env, "Unable to bind HCI socket").ThrowAsJavaScriptException();
        return;
    }

    uv_loop_t *loop;
    napi_get_uv_event_loop(env, &loop);

    this->uvPoll = (uv_poll_t *)malloc(sizeof(uv_poll_t));
    int res      = uv_poll_init(loop, this->uvPoll, this->sock);
    if (res != 0) {
        Napi::Error::New(env, "Unable to enroll HCI socket to uv_poll")
            .ThrowAsJavaScriptException();
        return;
    }

    this->uvPoll->data = (void *)this;
    uv_poll_start(this->uvPoll, UV_READABLE | UV_DISCONNECT, OnUVPoll);

    this->Ref();
}

void StoreDevInfo(Napi::Object &obj, struct hci_dev_info &di)
{
    char mac[18];
    sprintf(mac, "%02X:%02X:%02X:%02X:%02X:%02X", di.bdaddr[5], di.bdaddr[4], di.bdaddr[3],
            di.bdaddr[2], di.bdaddr[1], di.bdaddr[0]);
    size_t dev_type = (di.type >> 4) & 0x03;
    size_t bus_type = di.type & 0x0f;

    static const char *dev_types[] = {"PRIMARY", "AMP"};

    static const char *bus_types[] = {"VIRTUAL", "USB", "PCCARD", "UART", "RS232", "PCI",
                                      "SDIO",    "SPI", "I2C",    "SMD",  "VIRTIO"};

    obj.Set("name", di.name);
    obj.Set("mac", mac);
    obj.Set("up", (di.flags & (1 << HCI_UP)) != 0);

    if (dev_type < sizeof(dev_types) / sizeof(dev_types[0])) {
        obj.Set("type", dev_types[dev_type]);
    } else {
        obj.Set("type", dev_type);
    }
    if (bus_type < sizeof(bus_types) / sizeof(bus_types[0])) {
        obj.Set("bus", bus_types[bus_type]);
    } else {
        obj.Set("bus", bus_type);
    }
}

Napi::Value Socket::Info(const Napi::CallbackInfo &info)
{
    auto env = info.Env();

    Napi::Value ret;

    struct hci_dev_info di;
    memset(&di, 0, sizeof(struct hci_dev_info));
    di.dev_id = this->devId;
    if (ioctl(this->sock, HCIGETDEVINFO, (void *)&di) != -1) {
        auto obj = Napi::Object::New(env);
        StoreDevInfo(obj, di);
        ret = obj;
    } else {
        ret = Napi::Number::New(env, -errno);
    }

    return ret;
}

Napi::Value Socket::Send(const Napi::CallbackInfo &info)
{
    auto env = info.Env();
    if (this->sock == -1) {
        Napi::Error::New(env, "Socket is not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    size_t nargs = info.Length();
    if (nargs < 1 || !info[0].IsArrayBuffer()) {
        Napi::TypeError::New(env, "Argument must be a Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto buffer = info[0].As<Napi::ArrayBuffer>();
    if (buffer.ByteLength() < 4 || buffer.ByteLength() > HCI_MAX_FRAME_SIZE) {
        Napi::Error::New(env, "Buffer length must be between 4 and 1028 bytes")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // The libuv sets the socket to non-blocking, but we would like blocking writes,
    // since it's extremely uncommon the write actually would block (I guess?).
    // Ignore POLLERR result since errors are caught at the actual write (and by libuv).
    struct pollfd p;
    p.fd     = this->sock;
    p.events = POLLOUT;
    do {
        int pollres = poll(&p, 1, -1);
        if (pollres == -1 && errno == EINTR) {
            continue;
        }
    } while (0);

    ssize_t ret = write(this->sock, buffer.Data(), buffer.ByteLength());
    if (ret == -1) {
        ret = -errno;
    }

    return Napi::Number::New(env, ret);
}

void Socket::Close(const Napi::CallbackInfo &info) { Destroy(); }

void Socket::SetOpt(const Napi::CallbackInfo &info)
{
    auto env = info.Env();
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsArrayBuffer()) {
        Napi::Error::New(env, "setopt with invalid arguments")
            .ThrowAsJavaScriptException();
        return;
    }

    auto level = info[0].As<Napi::Number>();
    auto option = info[1].As<Napi::Number>();
    auto buffer = info[2].As<Napi::ArrayBuffer>();
    if (setsockopt(this->sock, level, option, buffer.Data(), buffer.ByteLength()) < 0) {
        Napi::Error::New(env, "setopt failed")
            .ThrowAsJavaScriptException();
    }
}

Napi::Object Socket::Init(Napi::Env env, Napi::Object exports)
{
    auto func = DefineClass(env, "Socket",
                            {
                                InstanceMethod<&Socket::Bind>("bind"),
                                InstanceMethod<&Socket::Info>("info"),
                                InstanceMethod<&Socket::Send>("send"),
                                InstanceMethod<&Socket::Close>("close"),
                                InstanceMethod<&Socket::SetOpt>("setopt"),
                            });

    exports.Set("Socket", func);

    auto funcRef = new Napi::FunctionReference();
    *funcRef     = Napi::Persistent(func);
    env.SetInstanceData(funcRef);

    return exports;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) { return Socket::Init(env, exports); }

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init);
