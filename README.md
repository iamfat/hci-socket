# @genee/hci-socket

```typescript
import HCISocket from '@genee/hci-socket';

const sock = new HCISocket(0);
sock.bind('raw');
sock.on('data', (data) => {

});
sock.setopt(0, HCI_FILTER, filterBuffer);
```
