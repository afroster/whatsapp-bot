const axios = require('axios')
const { Module} = require('../lib/plugins');
const { ytSearch, ytDownload } = require('../lib/youtube');
const addMeta = require('../lib/Class/metadata');

Module({
    command: 'song',
    package: 'downloader',
    description: 'Download YouTube music'
})(async (message, match) => {
    if (!match) return message.send('_Give me a song name_');
    const url = await ytSearch(match);
    if (!url) return message.send('enot found');
    const data = await ytDownload(url);
    if (!data || !data.url) {}
    const caption = `*${match}*

*SONG MENU*

1. Audio

2. MP3 Document

_Reply with 1 or 2_`;

    const thumb = await axios.get(data.thumbnail, {
        responseType: 'arraybuffer'
    });

    await message.send(Buffer.from(thumb.data), {
        caption,
        quoted: message
    });
});

Module({ on: 'text' })(async (message) => {
    if (!message.quoted || !message.body) return;
    const quoted = message.quoted;
    const caption = quoted.text || quoted.caption || '';
    if (!caption.includes('*SONG MENU*')) return;
    const choice = message.body.trim();
    if (!['1', '2'].includes(choice)) return;
    const title = caption.split('\n')[0].replace(/\*/g, '');
    const url = await ytSearch(title);
    if (!url) return message.send('_not found_');
    const data = await ytDownload(url);
    if (!data || !data.url)  return message.send('err');
    const [file, cover] = await Promise.all([
        axios.get(data.url, { responseType: 'arraybuffer' }),
        axios.get(data.thumbnail, { responseType: 'arraybuffer' })
    ]);

    const audio = await addMeta(
        Buffer.from(file.data),
        Buffer.from(cover.data),
        {
            title: data.title || title,
            artist: 'echo',
            album: 'afrosam_'
        }
    );

    if (choice === '1') {
        return message.send(audio, {
            mimetype: 'audio/mpeg',
            ptt: false
        });
    }

    return message.send(audio, {
        mimetype: 'audio/mpeg',
        document: true,
        fileName: `${title}.mp3`
    });
});
