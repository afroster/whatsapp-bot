const EventEmitter = require('events');

class BotEvents extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100);
    }

    emitEvent(name, ...args) {
        return this.emit(name, ...args);
    }

    onEvent(name, callback) {
        this.on(name, callback);
        return this;
    }

    onceEvent(name, callback) {
        this.once(name, callback);
        return this;
    }
}

module.exports = BotEvents;
