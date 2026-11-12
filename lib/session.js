const axios = require('axios');
const fs = require('fs');
const path = require('path');

class Connector{
    constructor() {
        this.x_url = 'https://api.jsonbin.io/v3/b';
        this.x_key = process.env.JSONBIN_KEY;
        this.sessionDir = path.resolve('./Session');
    }

    async restore(session_id, sessionDir = this.sessionDir) {
        try {
            if (!session_id?.startsWith('echo~')) {
                throw new Error('Invalid session ID');
            }

            if (!this.x_key) {
                throw new Error('JSONBIN_KEY is not configured');
            }

            const bin_id = session_id.replace('echo~', '');
            const { data } = await axios.get(
                `${this.x_url}/${bin_id}/latest`,
                {
                    headers: {
                        'X-Master-Key': this.x_key
                    },
                    timeout: 15000
                }
            );

            const files = data?.record?.files;
            if (!files || typeof files !== 'object') {
              throw new Error('Session files not found');
            }

            await fs.promises.mkdir(sessionDir, {
                recursive: true
            });

            for (const [fileName, fileData] of Object.entries(files)) {
                if (typeof fileData !== 'string') continue;

                const FP = path.resolve(sessionDir, fileName);
                const _RP = path.relative(sessionDir, FP);

                if (
                  _RP.startsWith('..') ||
                    path.isAbsolute(_RP)
                ) {
                    throw new Error(`Invalid session file: ${fileName}`);
                }

                await fs.promises.mkdir(path.dirname(FP), {
                    recursive: true
                });

                await fs.promises.writeFile(filePath, fileData, {
                    encoding: 'utf8',
                    mode: 0o600
                });
            }

            if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
                throw new Error('creds.json is missing');
            }

            console.log('Restored succes');
            return true;
        } catch (error) {
            console.error(error.message);
            throw error;
        }
    }
}

module.exports = new Connector();                
