const os = require('os');

class Logger {
    constructor(name = 'Ragnar') {
        this.name = name;
        this.colors = {
            reset: '\x1b[0m',
            cyan: '\x1b[36m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            red: '\x1b[31m',
            gray: '\x1b[90m',
            magenta: '\x1b[35m'
        };
    }

    print(level, color, message) {
        console.log(
            `${this.colors.gray}[${new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Johhansburg' })}]${this.colors.reset} ` +
            `${color}[${level}]${this.colors.reset} ` +
            `${this.colors.cyan}[${this.name}]${this.colors.reset} ${message}`
        );
    }

    info(message) {
        this.print('INFO', this.colors.cyan, message);
    }

    success(message) {
        this.print('SUCCESS', this.colors.green, message);
    }

    warn(message) {
        this.print('WARN', this.colors.yellow, message);
    }

    error(message) {
        this.print('ERROR', this.colors.red, message);
    }

    command(message) {
        this.print('COMMAND', this.colors.magenta, message);
    }

    system() {
        this.info(`Platform: ${os.platform()} | CPU: ${os.cpus()[0]?.model || 'unknown'} | RAM: ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`);
    }
}

module.exports = Logger
