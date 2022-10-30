import EventEmitter from 'events';
declare class Socket extends EventEmitter {
    constructor(devIndex: number);
    bind(mode?: 'raw' | 'user' | 'control'): void;
    close(): void;
    send(data: ArrayBuffer): number;
    setopt(level: number, opt: number, value: ArrayBuffer): void;
}
export = Socket;
