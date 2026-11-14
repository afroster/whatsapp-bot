const { spawn } = require('child_process');
const ID3Writer = require('browser-id3-writer');

function toAudio(buffer) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0',
            '-f', 'mp3',
            '-vn',
            '-acodec', 'libmp3lame',
            '-ab', '192k',
            '-ar', '44100',
            'pipe:1'
        ]);

        const chunks = [];

        ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => {});
        ffmpeg.on('error', reject);

        ffmpeg.on('close', code => {
            if (code !== 0) {
                return reject(new Error('failed'));
            }

            resolve(Buffer.concat(chunks));
        });

        ffmpeg.stdin.on('error', reject);
        ffmpeg.stdin.end(buffer);
    });
}

async function addMeta(buffer, cover, options = {}) {
    const title = options.title || 'music';
    const artist = options.artist || 'echo';
    const album = options.album || 'afrosam_';

    const audio = await toAudio(buffer);
    const writer = new ID3Writer(audio);

    writer.setFrame('TIT2', title);
    writer.setFrame('TPE1', [artist]);
    writer.setFrame('TALB', album);
    writer.setFrame('TYER', new Date().getFullYear());

    if (cover) {
        writer.setFrame('APIC', {
            type: 3,
            data: cover,
            description: 'Cover'
        });
    }

    writer.addTag();

    return Buffer.from(writer.arrayBuffer);
}

module.exports = addMeta;
          
