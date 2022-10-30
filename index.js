const Socket = require('bindings')('socket').Socket;
const { EventEmitter } = require('events');

function inherits(target, source) {
    for (var k in source.prototype) {
      target.prototype[k] = source.prototype[k];
    }
  }
  
inherits(Socket, EventEmitter);

module.exports = Socket;