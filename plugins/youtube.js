const axios = require('axios')
const { Module} = require('../lib/plugins');
const { ytSearch, 
       ytDownload }
       = require('../lib/youtube');
const addMeta = require('../lib/Class/metadata');
const youtube = require("../lib/youtube");

Module({
    command: "song",
    package: "downloader",
    description: "Search YouTube songs"
})(async (message, match) => {
    const query = match?.trim();
    if (!query) {
    return message.send(".song <song name>");}
    const buttons = message.ui.enabled();
    try {  const status = buttons
            ? null
            : await message.send("Searching Yt...");

        const results = await youtube.search(query, {
            limit: 10
        });

        if (!results?.length) return message.send("No found");
        const songs = results.map(video => ({
            title: video.title,
            url: video.url || `https://www.youtube.com/watch?v=${video.id}`,
            duration: video.duration,
            channel: video.author || video.channel?.name || "afrosame_0x"
        }));

        const text = [
            "*RESULTS*",
            `Query: ${query}`,
            "",
            ...songs.map((song, index) =>
                `*${index + 1}. ${song.title}*\n${song.channel} · ${song.duration}\n${message.ui.cmd("play", song.url)}`
            )
        ].join("\n\n");

        if (!buttons) {
            if (status?.key) {
                return message.conn.sendMessage(message.from, {
                    text,
                    edit: status.key
                });
            }

            return message.send(text);
        }

        return message.sendList({
            text,
            header: "ragnar-md",
            body: `Results for: ${query}`,
            footer: "YouTube Music",
            button: "Show Songs",
            sections: [{
                title: "Search Results",
                rows: songs.map(song => ({
                    title: song.title,
                    description: `${song.duration} · ${song.channel}`,
                    id: message.ui.cmd("play", song.url)
                }))
            }]
        });
    } catch (error) {
        console.error(error);
        return message.send("err");
    }
});
                
Module({
    command: "play",
    package: "downloader",
    description: "Download YouTube songs as MP3"
})(async (message, match) => {
    const query = match?.trim();
    if (!query) return message.send("Usage: .play <YouTube URL or song name>");
    try { await message.send("Downloading audio...");
        const results = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(query)
            ? [{ url: query, title: "YouTube Audio" }]
           : await youtube.search(query, { limit: 1 });
        if (!results?.length) {
            return message.send("No");
        }
        const song = results[0];
        const url = song.url || `https://www.youtube.com/watch?v=${song.id}`;
        const audio = await youtube.downloadAudio(url, {
            bitrate: 128
        });

        if (!audio) return;
        return message.send({
            audio: audio.buffer || audio,
            mimetype: "audio/mpeg",
            fileName: `${song.title || "ragnar"}.mp3`,
            ptt: false
        });
    } catch (error) {
        console.error(error);
        return;    }
});

Module({
    command: 'ytm',
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
