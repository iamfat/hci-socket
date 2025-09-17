const { EventEmitter } = require('events');

/**
 * HCI 包类型定义
 */
const HCIPacketType = {
    COMMAND: 0x01,
    EVENT: 0x04,
};

/**
 * BLE 命令操码定义
 */
const BLECommandOpCode = {
    // 标准命令
    READ_BD_ADDR: 0x1009, // 读取本地蓝牙地址
    SET_EVENT_MASK: 0x0c01, // 设置事件掩码
    VENDOR_SPECIFIC: 0x0c6d, // 厂商特定命令
    // LE 控制器命令
    LE_SET_EVENT_MASK: 0x2001, // 设置 LE 事件掩码
    LE_SET_SCAN_PARAMETERS: 0x200b,
    LE_SET_SCAN_ENABLE: 0x200c,
    LE_CREATE_CONNECTION: 0x200d,
    LE_CANCEL_CONNECTION: 0x200e,
    LE_CONNECTION_UPDATE: 0x2013,
    LE_REMOTE_CONN_PARAM_REQ_REPLY: 0x2020,
    LE_REMOTE_CONN_PARAM_REQ_NEG_REPLY: 0x2021,
};

/**
 * BLE 事件码定义
 */
const BLEEventCode = {
    COMMAND_COMPLETE: 0x0e,
    LE_META_EVENT: 0x3e,
};

/**
 * LE Meta 子事件定义
 */
const LEMetaSubEvent = {
    LE_CONNECTION_COMPLETE: 0x01,
    LE_ADVERTISING_REPORT: 0x02,
    LE_CONNECTION_UPDATE_COMPLETE: 0x03,
    LE_REMOTE_CONN_PARAM_REQUEST: 0x06,
};

const USER_SERVICE_UUID = 'B84E44A0-BCD3-4C56-9132-14FE954F9360';
const USER_CHAR_RELAY_UUID = '44A1';
const USER_CHAR_THRESHOLD_UUID = '44A3';
const USER_CHAR_BEEP_UUID = '44A7';

const COMMON_SERVICE_UUID = 'BB649E60-0544-432E-8944-027485D05926';

/**
 * 模拟 BLE HCI Socket 类
 * 用于模拟 BLE HCI 接口的行为
 */
class MockBLESocket extends EventEmitter {
    /**
     * 构造函数
     */
    constructor() {
        super();
        // 扫描状态
        this.isScanning = false;
        // 模拟设备列表
        this.mockDevices = [
            {
                addr: 'AA:BB:CC:DD:EE:DD',
                name: 'GMETER',
                manufacturerData: new Uint8Array([
                    // manufacturer (uint16_t) - 2字节
                    0x01,
                    0x00,

                    // mac (uint8_t[6]) - 6字节
                    0xDD,
                    0xEE,
                    0xDD,
                    0xCC,
                    0xBB,
                    0xAA,

                    // power (uint16_t LE) - 2字节
                    0x64,
                    0x00, // 100W (小端序)

                    // current (uint16_t LE) - 2字节
                    0x32,
                    0x00, // 50mA (小端序)

                    // voltage (uint8_t) - 1字节
                    0xb4, // 180V

                    // state (uint8_t) - 1字节
                    0x01, // STATE_RELAY 开启

                    // modeAndModel (uint8_t) - 1字节
                    0x01, // METER_MODEL_X

                    // relayCounter (uint8_t) - 1字节
                    0x05, // 继电器计数器值为5
                ]), // 厂商数据
                serviceUUIDs: [USER_SERVICE_UUID], // 服务UUID列表
                gattServices: {
                    [USER_SERVICE_UUID]: {
                        [USER_CHAR_RELAY_UUID]: new Uint8Array([0x01]).buffer,
                        [USER_CHAR_THRESHOLD_UUID]: new Float32Array([10.0]).buffer,
                        [USER_CHAR_BEEP_UUID]: new Uint8Array([0x00]).buffer,
                    },
                },
            },
            {
                addr: 'AA:BB:CC:DD:EE:FF',
                name: 'GMETER',
                manufacturerData: new Uint8Array([
                    // manufacturer (uint16_t) - 2字节
                    0x01,
                    0x00,

                    // mac (uint8_t[6]) - 6字节
                    0xFF,
                    0xEE,
                    0xDD,
                    0xCC,
                    0xBB,
                    0xAA,

                    // power (uint16_t LE) - 2字节
                    0x64,
                    0x00, // 100W (小端序)

                    // current (uint16_t LE) - 2字节
                    0x32,
                    0x00, // 50mA (小端序)

                    // voltage (uint8_t) - 1字节
                    0xb4, // 180V

                    // state (uint8_t) - 1字节
                    0x01, // STATE_RELAY 开启

                    // modeAndModel (uint8_t) - 1字节
                    0x00, // METER_MODEL_A

                    // relayCounter (uint8_t) - 1字节
                    0x05, // 继电器计数器值为5
                ]),
                serviceUUIDs: [COMMON_SERVICE_UUID],
                gattServices: {
                    [COMMON_SERVICE_UUID]: {},
                },
            },
        ];
        // 活动连接列表
        this.activeConnections = new Map();
        // 默认连接参数
        this.defaultParams = {
            connInterval: 0x0010, // 20ms
            connLatency: 0,
            supervisionTimeout: 0x0c80, // 3.2s
        };
        // 本地蓝牙地址
        this.localBdAddr = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
        // 事件掩码 (默认全部开启)
        this.eventMask = new Uint8Array(8).fill(0xff);
        // LE 事件掩码 (默认全部开启)
        this.leEventMask = new Uint8Array(8).fill(0xff);
    }

    /**
     * 发送 HCI 命令或 ACL 数据
     * @param {ArrayBuffer} data - HCI 命令或ACL数据
     */
    send(data) {
        const view = new Uint8Array(data);
        const packetType = view[0];

        if (packetType === HCIPacketType.COMMAND) {
            const opCode = (view[2] << 8) | view[1]; // 注意字节序
            const paramLength = view[3];
            const params = view.slice(4, 4 + paramLength);

            this.handleHCICommand(opCode, params);
        } else if (packetType === 0x02) { // ACL Data Packet
            // 结构: 0x02 | handle_lo | handle_hi | dlen_lo | dlen_hi | payload...
            const handle = view[1] | ((view[2] & 0x0F) << 8);
            const dlen = view[3] | (view[4] << 8);
            const cid = view[6] | (view[7] << 8);
            const attPayload = view.slice(8, 8 + dlen - 4); // 4字节 L2CAP header
            if (cid === 0x0004) {
                this.handleATT(handle, attPayload);
            }
        }
    }

    /**
     * 处理 HCI 命令
     * @param {number} opCode - 命令操作码
     * @param {Uint8Array} params - 命令参数
     */
    handleHCICommand(opCode, params) {
        // console.debug(`处理 HCI 命令: 0x${opCode.toString(16)}`);
        switch (opCode) {
            case BLECommandOpCode.LE_SET_SCAN_ENABLE:
                this.handleSetScanEnable(params);
                break;
            case BLECommandOpCode.LE_CREATE_CONNECTION:
                this.handleCreateConnection(params);
                break;
            case BLECommandOpCode.LE_CONNECTION_UPDATE:
                this.handleConnectionUpdate(params);
                break;
            case BLECommandOpCode.READ_BD_ADDR:
                this.handleReadBdAddr();
                break;
            case BLECommandOpCode.SET_EVENT_MASK:
                this.handleSetEventMask(params);
                break;
            case BLECommandOpCode.LE_SET_EVENT_MASK:
                this.handleLeSetEventMask(params);
                break;
            case BLECommandOpCode.VENDOR_SPECIFIC:
                this.handleVendorSpecific(params);
                break;
            default:
                this.emitCommandComplete(opCode, new Uint8Array([0x00]));
        }
    }

    /**
     * 处理设置事件掩码命令 (0x0C01)
     * @param {Uint8Array} params - 8字节事件掩码
     */
    handleSetEventMask(params) {
        this.eventMask.set(params.slice(0, 8));
        this.emitCommandComplete(BLECommandOpCode.SET_EVENT_MASK, new Uint8Array([0x00]));
    }

    /**
     * 处理设置 LE 事件掩码命令 (0x2001)
     * @param {Uint8Array} params - 8字节 LE 事件掩码
     */
    handleLeSetEventMask(params) {
        this.leEventMask.set(params.slice(0, 8));
        this.emitCommandComplete(BLECommandOpCode.LE_SET_EVENT_MASK, new Uint8Array([0x00]));
    }

    /**
     * 处理读取蓝牙地址命令 (0x1009)
     */
    handleReadBdAddr() {
        const response = new Uint8Array(7);
        response[0] = 0x00; // 状态码：成功
        response.set(this.localBdAddr, 1);
        this.emitCommandComplete(BLECommandOpCode.READ_BD_ADDR, response);
    }

    /**
     * 处理厂商特定命令 (0x0C6D)
     * @param {Uint8Array} params - 命令参数
     */
    handleVendorSpecific(params) {
        const subCommand = params[0];
        const cmdParams = params.slice(1);

        let response;
        switch (subCommand) {
            case 0x01:
                response = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
                break;
            case 0x02:
                response = new Uint8Array([0x00, 0xff, 0xff]);
                break;
            default:
                response = new Uint8Array([0x00]);
        }

        this.emitCommandComplete(BLECommandOpCode.VENDOR_SPECIFIC, response);
    }

    /**
     * 处理扫描使能命令
     * @param {Uint8Array} params - 命令参数
     */
    handleSetScanEnable(params) {
        const enable = params[0] === 0x01;
        this.isScanning = enable;

        this.emitCommandComplete(BLECommandOpCode.LE_SET_SCAN_ENABLE, new Uint8Array([0x00]));

        if (enable) {
            this.startMockDiscovery();
        } else {
            // 停止扫描时清除所有定时器
            if (this.discoveryTimers) {
                this.discoveryTimers.forEach(timer => clearInterval(timer));
                this.discoveryTimers = [];
            }
        }
    }

    /**
     * 处理创建连接命令
     * @param {Uint8Array} params - 命令参数
     */
    handleCreateConnection(params) {
        const handle = 0x0040; // 模拟连接句柄
        this.activeConnections.set(handle, { ...this.defaultParams });

        setTimeout(() => {
            this.emitConnectionComplete(0x00, handle);
        }, 100);
    }

    /**
     * 处理连接参数更新命令
     * @param {Uint8Array} params - 命令参数
     */
    handleConnectionUpdate(params) {
        const handle = params[0] | (params[1] << 8);
        const newParams = {
            connInterval: params[2] | (params[3] << 8),
            connLatency: params[4] | (params[5] << 8),
            supervisionTimeout: params[6] | (params[7] << 8),
        };

        if (this.validateConnectionParameters(newParams)) {
            this.activeConnections.set(handle, newParams);
            this.emitCommandComplete(BLECommandOpCode.LE_CONNECTION_UPDATE, new Uint8Array([0x00]));

            setTimeout(() => {
                this.emitConnectionUpdateComplete(handle, newParams);
            }, 100);
        } else {
            this.emitCommandComplete(BLECommandOpCode.LE_CONNECTION_UPDATE, new Uint8Array([0x12])); // Invalid Parameters
        }
    }

    /**
     * 验证连接参数
     * @param {Object} params - 连接参数
     * @returns {boolean} 参数是否有效
     */
    validateConnectionParameters(params) {
        const { connInterval, connLatency, supervisionTimeout } = params;

        // 验证参数范围
        if (connInterval < 0x0006 || connInterval > 0x0c80) return false;
        if (connLatency > 0x01f3) return false;
        if (supervisionTimeout < 0x000a || supervisionTimeout > 0x0c80) return false;

        // 验证超时时间
        const minTimeout = (1 + connLatency) * connInterval * 2;
        if (supervisionTimeout * 10 < minTimeout * 1.25) return false;

        return true;
    }

    /**
     * 开始模拟设备发现
     */
    startMockDiscovery() {
        if (!this.isScanning) return;

        // 清除可能存在的之前的定时器
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
        }

        // 为每个设备创建独立的定时器
        this.mockDevices.forEach((device, index) => {
            setTimeout(() => {
                if (!this.isScanning) return;
                
                const timer = setInterval(() => {
                    if (!this.isScanning) {
                        clearInterval(timer);
                        return;
                    }
                    this.emitAdvertisingReport(device);
                }, 2000);

                // 将定时器保存到数组中以便后续清理
                if (!this.discoveryTimers) {
                    this.discoveryTimers = [];
                }
                this.discoveryTimers.push(timer);
            }, index * 500); // 每个设备错开500ms开始广播
        });
    }

    /**
     * 发送命令完成事件
     * @param {number} opCode - 命令操作码
     * @param {Uint8Array} params - 事件参数
     */
    emitCommandComplete(opCode, params) {
        const response = new Uint8Array(7 + params.length);
        response[0] = HCIPacketType.EVENT;
        response[1] = BLEEventCode.COMMAND_COMPLETE;
        response[2] = params.length + 3;
        response[3] = 1; // 可用命令包数量
        response[4] = opCode & 0xff;
        response[5] = (opCode >> 8) & 0xff;
        response.set(params, 6);

        this.emit('data', response.buffer);
    }

    /**
     * 发送连接完成事件
     * @param {number} status - 状态码
     * @param {number} handle - 连接句柄
     */
    emitConnectionComplete(status, handle) {
        const response = new Uint8Array(19);
        response[0] = HCIPacketType.EVENT;
        response[1] = BLEEventCode.LE_META_EVENT;
        response[2] = 0x13;
        response[3] = LEMetaSubEvent.LE_CONNECTION_COMPLETE;
        response[4] = status;
        response[5] = handle & 0xff;
        response[6] = (handle >> 8) & 0xff;
        response.fill(0, 7);

        this.emit('data', response.buffer);
    }

    /**
     * 发送广播报告事件
     * @param {Object} device - 设备信息
     */
    emitAdvertisingReport(device) {
        const addrBytes = device.addr.split(':').map((x) => parseInt(x, 16)).reverse();
        const nameBytes = Buffer.from(device.name);
        const rssi = -55 - Math.floor(Math.random() * 6);

        // 计算广播数据总长度
        let totalLength = 0;

        // 计算设备名称长度: Length(1) + Type(1) + Data(n)
        const nameLength = nameBytes.length + 2;
        totalLength += nameLength;

        // 分离16位和128位UUID
        const uuid16s = [];
        const uuid128s = [];
        if (device.serviceUUIDs) {
            device.serviceUUIDs.forEach(uuid => {
                if (uuid.length <= 4) {
                    uuid16s.push(uuid);
                } else {
                    uuid128s.push(uuid);
                }
            });
        }

        // 计算16位UUID长度: Length(1) + Type(1) + UUIDs(n*2)
        const uuid16Length = uuid16s.length > 0 ? (2 + uuid16s.length * 2) : 0;
        totalLength += uuid16Length;

        // 计算128位UUID长度: Length(1) + Type(1) + UUIDs(n*16)
        const uuid128Length = uuid128s.length > 0 ? (2 + uuid128s.length * 16) : 0;
        totalLength += uuid128Length;

        // 计算厂商数据长度: Length(1) + Type(1) + Data(n)
        const manuLength = device.manufacturerData ? (device.manufacturerData.length + 2) : 0;
        totalLength += manuLength;

        // 创建广播数据
        const adData = new Uint8Array(totalLength);
        let offset = 0;

        // 添加设备名称
        if (nameBytes.length > 0) {
            adData[offset] = nameBytes.length + 1; // 长度（包括类型字节）
            adData[offset + 1] = 0x09; // Complete Local Name
            adData.set(nameBytes, offset + 2);
            offset += nameBytes.length + 2;
        }

        // 添加16位服务UUID
        if (uuid16s.length > 0) {
            adData[offset] = uuid16s.length * 2 + 1; // 长度（包括类型字节）
            adData[offset + 1] = 0x03; // Complete List of 16-bit Service UUIDs
            uuid16s.forEach((uuid, index) => {
                const uuidBytes = parseInt(uuid, 16);
                adData[offset + 2 + index * 2] = uuidBytes & 0xff;
                adData[offset + 2 + index * 2 + 1] = (uuidBytes >> 8) & 0xff;
            });
            offset += uuid16s.length * 2 + 2;
        }

        // 添加128位服务UUID
        if (uuid128s.length > 0) {
            uuid128s.forEach(uuid => {
                adData[offset] = 17; // 长度（16字节UUID + 1字节类型）
                adData[offset + 1] = 0x07; // Complete List of 128-bit Service UUIDs
                // 将UUID字符串转换为字节数组
                const uuid_bytes = uuid.replace(/-/g, '').match(/.{2}/g)
                    .map(byte => parseInt(byte, 16))
                    .reverse(); // 转换为小端序
                adData.set(uuid_bytes, offset + 2);
                offset += 18;
            });
        }

        // 添加厂商数据
        if (device.manufacturerData && device.manufacturerData.length > 0) {
            adData[offset] = device.manufacturerData.length + 1; // 长度（包括类型字节）
            adData[offset + 1] = 0xff; // Manufacturer Specific Data
            adData.set(device.manufacturerData, offset + 2);
            offset += device.manufacturerData.length + 2;
        }

        // 创建HCI事件包
        const response = new Uint8Array(15 + totalLength); // 2(header) + 1(subevent) + 1(num reports) + 1(event type) + 1(addr type) + 6(addr) + 1(data len) + data + 1(rssi)
        response[0] = HCIPacketType.EVENT;
        response[1] = BLEEventCode.LE_META_EVENT;
        response[2] = 0x0a + totalLength; // 参数长度 = 10(固定头部) + 数据长度
        response[3] = LEMetaSubEvent.LE_ADVERTISING_REPORT;
        response[4] = 0x01; // 报告数量
        response[5] = 0x00; // 事件类型 (ADV_IND)
        response[6] = 0x00; // 地址类型 (Public)
        response.set(new Uint8Array(addrBytes), 7); // MAC地址 (6字节，LSB)
        response[13] = adData.length; // 广播数据的实际长度
        response.set(adData, 14); // 设置广播数据
        response[14 + adData.length] = rssi; // RSSI值放在广播数据之后

        this.emit('data', response.buffer);
    }

    /**
     * 发送连接参数更新完成事件
     * @param {number} handle - 连接句柄
     * @param {Object} params - 连接参数
     */
    emitConnectionUpdateComplete(handle, params) {
        const response = new Uint8Array(12);
        response[0] = HCIPacketType.EVENT;
        response[1] = BLEEventCode.LE_META_EVENT;
        response[2] = 0x0a;
        response[3] = LEMetaSubEvent.LE_CONNECTION_UPDATE_COMPLETE;
        response[4] = 0x00;
        response[5] = handle & 0xff;
        response[6] = (handle >> 8) & 0xff;
        response[7] = params.connInterval & 0xff;
        response[8] = (params.connInterval >> 8) & 0xff;
        response[9] = params.connLatency & 0xff;
        response[10] = (params.connLatency >> 8) & 0xff;
        response[11] = params.supervisionTimeout & 0xff;
        response[12] = (params.supervisionTimeout >> 8) & 0xff;

        this.emit('data', response.buffer);
    }

    /**
     * 发送远程连接参数请求事件
     * @param {number} handle - 连接句柄
     * @param {Object} params - 连接参数
     */
    emitRemoteConnectionParameterRequest(handle, params) {
        const response = new Uint8Array(11);
        response[0] = HCIPacketType.EVENT;
        response[1] = BLEEventCode.LE_META_EVENT;
        response[2] = 0x09;
        response[3] = LEMetaSubEvent.LE_REMOTE_CONN_PARAM_REQUEST;
        response[4] = handle & 0xff;
        response[5] = (handle >> 8) & 0xff;
        response[6] = params.connInterval & 0xff;
        response[7] = (params.connInterval >> 8) & 0xff;
        response[8] = params.connLatency & 0xff;
        response[9] = (params.connLatency >> 8) & 0xff;
        response[10] = params.supervisionTimeout & 0xff;
        response[11] = (params.supervisionTimeout >> 8) & 0xff;

        this.emit('data', response.buffer);
    }

    /**
     * 请求更新连接参数
     * @param {number} handle - 连接句柄
     * @param {Object} params - 连接参数
     */
    requestConnectionParameterUpdate(handle, params) {
        if (!this.activeConnections.has(handle)) {
            console.error('Connection handle not found:', handle);
            return;
        }

        this.emitRemoteConnectionParameterRequest(handle, params);
    }

    up() {}

    down() {}

    close() {}

    info() {
        return {
            name: 'hci0',
            mac: '00:00:00:00:00:00',
            type: 'PRIMARY',
            bus: 'USB',
            up: true,
        };
    }

    bind() {}

    setopt() {}

    /**
     * 处理 ATT 命令
     * @param {number} handle - 连接句柄
     * @param {Uint8Array} attPayload - ATT 命令负载
     */
    handleATT(handle, attPayload) {
        // 维护 handle <-> deviceId 映射
        if (!this.handleToDeviceId) this.handleToDeviceId = {};
        if (!this.handleToDeviceId[handle]) {
            // 只支持第一个 mockDevice
            this.handleToDeviceId[handle] = this.mockDevices[0].addr;
        }
        const deviceId = this.handleToDeviceId[handle];
        const device = this.mockDevices.find(d => d.addr === deviceId);
        if (!device) return;
        const gatt = device.gattServices[USER_SERVICE_UUID];
        const op = attPayload[0];
        // ATT 响应
        let resp;
        if (op === 0x10) { // Read By Group Type Request (服务发现)
            // 只返回 USER_SERVICE_UUID
            resp = new Uint8Array([
                0x11, // Read By Group Type Response
                0x14, // 每组长度 20字节 (handle+handle+128bit uuid)
                0x01, 0x00, // start handle
                0x05, 0x00, // end handle
                ...Array.from(Buffer.from(USER_SERVICE_UUID.replace(/-/g, ''), 'hex')).reverse(),
            ]);
        } else if (op === 0x08) { // Read By Type Request (特征发现)
            // 返回 44A1/44A3/44A7 三个特征
            resp = new Uint8Array([
                0x09, // Read By Type Response
                0x07, // 每组长度 7字节 (handle+props+valueHandle+uuid)
                // 44A1
                0x02, 0x00, // char handle
                0x02, // props: read|write
                0x03, 0x00, // value handle
                0xA1, 0x44, // uuid
                // 44A3
                0x04, 0x00,
                0x02,
                0x05, 0x00,
                0xA3, 0x44,
                // 44A7
                0x06, 0x00,
                0x02,
                0x07, 0x00,
                0xA7, 0x44,
            ]);
        } else if (op === 0x0A) { // Read Request
            // 只支持 44A1/44A3/44A7
            const valueHandle = attPayload[1] | (attPayload[2] << 8);
            let value;
            if (valueHandle === 0x03) value = new Uint8Array(gatt[USER_CHAR_RELAY_UUID]);
            else if (valueHandle === 0x05) value = new Uint8Array(gatt[USER_CHAR_THRESHOLD_UUID]);
            else if (valueHandle === 0x07) value = new Uint8Array(gatt[USER_CHAR_BEEP_UUID]);
            else value = new Uint8Array([]);
            resp = new Uint8Array([0x0b, ...value]); // Read Response
        } else if (op === 0x12) { // Write Request
            // 只支持 44A1/44A3/44A7
            const valueHandle = attPayload[1] | (attPayload[2] << 8);
            const value = attPayload.slice(3);
            if (valueHandle === 0x03) gatt[USER_CHAR_RELAY_UUID] = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            else if (valueHandle === 0x05) gatt[USER_CHAR_THRESHOLD_UUID] = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            else if (valueHandle === 0x07) gatt[USER_CHAR_BEEP_UUID] = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            resp = new Uint8Array([0x13]); // Write Response
        } else {
            // 不支持的操作，返回错误
            resp = new Uint8Array([0x01, attPayload[1] || 0x00, attPayload[2] || 0x00, 0x06]); // ATT Error: Request Not Supported
        }
        // 组装 HCI ACL Data 包
        const l2capLen = resp.length + 4;
        const aclLen = l2capLen;
        const out = new Uint8Array(5 + aclLen);
        out[0] = 0x02; // ACL Packet
        out[1] = handle & 0xff;
        out[2] = (handle >> 8) & 0x0f;
        out[3] = aclLen & 0xff;
        out[4] = (aclLen >> 8) & 0xff;
        out[5] = resp.length + 4 & 0xff; // L2CAP length
        out[6] = (resp.length + 4) >> 8;
        out[7] = 0x04; // CID = 0x0004 (ATT)
        out[8] = 0x00;
        out.set(resp, 9);
        this.emit('data', out.buffer);
    }
}

module.exports = MockBLESocket;
