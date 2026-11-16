
const {Module} = require('../lib/plugins');
const acrcloud = require('acrcloud');
const axios = require('axios');
const { ytSearch, ytDownload } = require('../lib/youtube');
const addMeta = require('../lib/Calss/metadata');

const acr = new acrcloud({
    host: "identify-ap-southeast-1.acrcloud.com",
    access_key: "ee1b81b47cf98cd73a0072a761558ab1",
    access_secret: "ya9OPe8onFAnNkyf9xMTK8qRyMGmsghfuHrIMmUI",
});

const meta_timer = (milliseconds = 0) => {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return "0:00";
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const empty_file = (name) => { return name.replace(/[\\/:*?"<>|]/g, '').trim(); };
async function Shazam(buffer) {
    const res = await acr.identify(buffer);
    const data = res.metadata;
    if (!data?.music?.length) return null;
    return data.music.map((a) => ({
        title: a.title,
        artist: a.artists?.[0]?.name || "echo",
        score: a.score,
        release: a.release_date
            ? new Date(a.release_date).toLocaleDateString("id-ID")
            : "N/A",
        duration: meta_timer(a.duration_ms),
        thumbnail:
            a.external_metadata?.spotify?.album?.images?.[0]?.url ||
            a.external_metadata?.deezer?.album?.cover_big ||
            null,

        youtubeUrl: a.external_metadata?.youtube?.vid
            ? "https://youtu.be/" + a.external_metadata.youtube.vid
            : null,
    }));
}

Module({
    command: "find",
    package: "acrcloud",
    description: "Identify and download songs"
})(async (message, match) => {
    if (!message.quoted) return message.send("_Reply to an audio or voice_");    
    const buffer = await message.quoted.download();
    if (!buffer) return message.send("err");
    const results = await Shazam(buffer);
    if (!results) return message.send("_No match_");
    const song = results[0];
    const captiom = `*SHAZAM*

*${song.title}*

*Artist:* ${song.artist}
*Duration:* ${song.duration}
*Release:* ${song.release}
*Match:* ${song.score}%

1. Document (MP3)
2. Video (MP4)

*_Reply with 1 or 2_*`;

    if (song.thumbnail) {
        const thumb = await axios.get(song.thumbnail, {
            responseType: 'arraybuffer'
        });

        return message.send(Buffer.from(thumb.data), {
            caption,
            quoted: message
        });}
    return message.send(caption);
});

Module({ on: 'text' })(async (message) => {
    if (!message.quoted || !message.body) return;
    const quoted = message.quoted;
    const caption = quoted.text || quoted.caption || '';
    if (!caption.includes('*SHAZAM*')) return;
    const choice = message.body.trim();
    if (!['1', '2'].includes(choice)) return;
    const title = caption.split('\n')[2].replace(/\*/g, '').trim();
    const url = await ytSearch(title);
    if (!url) { return message.send("_not found_");}

    const data = await ytDownload(url);
    if (!data || !data.url) return;
    const f_nme = empty_file(title);
    if (choice === '1') {
        const [file, cover] = await Promise.all([
            axios.get(data.url, {
                responseType: 'arraybuffer'
            }),
            data.thumbnail
                ? axios.get(data.thumbnail, {
                    responseType: 'arraybuffer'
                })
                : Promise.resolve(null)
        ]);

        const audio = await addMeta(
            Buffer.from(file.data),
            cover ? Buffer.from(cover.data) : Buffer.alloc(0),
            {
                title: data.title || title,
                artist: 'echo',
                album: 'afrosam_'
            }
        );

        return message.send(audio, {
            mimetype: 'audio/mpeg',
            document: true,
            fileName: `${f_nme}.mp3`
        });
    }

    if (choice === '2') {
        if (!data.videoUrl) return;
        const video = await axios.get(data.videoUrl, {
            responseType: 'arraybuffer'
        });

        return message.send(Buffer.from(video.data), {
            mimetype: 'video/mp4',
            fileName: `${f_nme}.mp4`
        });
    }
});
  
