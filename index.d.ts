import EventEmitter from 'events';
declare type DeviceInfo = {
    name: string;
    mac: string;
    up: boolean;
    type: 'PRIMARY' | 'AMP';
    bus: 'VIRTUAL' | 'USB' | 'PCCARD' | 'UART' | 'RS232' | 'PCI' | 'SDIO' | 'SPI' | 'I2C' | 'SMD' | 'VIRTIO';
};
declare class Socket extends EventEmitter {
    constructor(devId: number);
    bind(mode?: 'raw' | 'user' | 'control'): void;
    close(): void;
    send(data: ArrayBuffer): number;
    setopt(level: number, opt: number, value: ArrayBuffer): void;
    up(): void;
    down(): void;
    info(): DeviceInfo;
}
export = Socket;
