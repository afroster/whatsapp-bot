const http = require('http');

class _Server {
    constructor(port = process.env.PORT || 8000) {
        this.port = port;
        this.server = null;
    }

    _start() {
        this.server = http.createServer((req, res) => {
            res.writeHead(200, {
                'Content-Type': 'application/json'
            });

            res.end(JSON.stringify({
                status: 'success',
                message: 'Ragnar bot is running'
            }));
        });

        this.server.listen(this.port, () => {
            console.log(`Server running on port ${this.port}`);
        });

        return this.server;
    }
}

module.exports = _Server;
