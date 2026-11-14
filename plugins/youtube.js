const fs = require('fs');
const fetch = require('node-fetch');
const { Module } = require('../lib/plugins');
const axios = require('axios');
const { ytSearch, ytDownload } = require('../lib/youtube');
const addMeta = require('../lib/Class/metadata');

Module({
    command: 'song',
    package: 'downloader',
    description: 'Download YouTube music'
})(async (message, match) => {
    try { if (!match) {
      return await message.send('_Give me a *song name*_');}
        const url = await ytSearch(match);
        const data = await ytDownload(url);
        if (!data?.success || !data?.url) {
            return await message.send('_not found_');}
        const cover = await axios.get(data.thumbnail, {
            responseType: 'arraybuffer'
        });

        const thumb = Buffer.from(cover.data);
        const caption = `*${match}*

╭━━〔 *SONG MENU* 〕
┃
┃ 1. ⛥Audio
┃ 2. ⛥MP3 Document
┃
╰━━━━━━━━━━━━

_Reply with a number_`;

        await message.send({
            image: thumb,
            caption
        });

    } catch (err) {}
});


Module({
    on: 'text'
})(async (message) => {
        if (!message.quoted) return;
        const body =
            message.quoted.body ||
            message.quoted.msg?.text ||
            message.quoted.msg?.caption ||
            '';

        if (!body.includes('SONG MENU')) return;
        const choice = message.body.trim();
        if (!['1', '2'].includes(choice)) return;
        const title = body
            .split('\n')[0]
            .replace(/[⛥*_]/g, '')
            .trim();

        if (!title) return;
        const url = await ytSearch(title);
        const data = await ytDownload(url);
        if (!data?.success || !data?.url) {
        return await message.send('_eish_');}
        const [file, cover] = await Promise.all([
            axios.get(data.url, {
                responseType: 'arraybuffer'
            }),
            axios.get(data.thumbnail, {
                responseType: 'arraybuffer'
            })
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
            await message.send({audio, mimetype: 'audio/mpeg'
            });
        }

        if (choice === '2') {
            const fileName = (data.title || title)
                .replace(/[^\w\s-]/g, '')
                .trim() + '.mp3';

            await message.send({
                document: audio,
                mimetype: 'audio/mpeg',
                fileName
            });
        }

});



const x = 'AIzaSyDLH31M0HfyB7Wjttl6QQudyBEq5x9s1Yg';
async function ytSearch(query, max = 10) {
  const url = `https://www.googleapis.com/youtube/v3/search?key=${x}&part=snippet&type=video&maxResults=${max}&q=${query}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  if (!data.items || !data.items.length) return [];
  return data.items.map(vid => ({
    id: vid.id.videoId,
    title: vid.snippet.title,
    url: `https://www.youtube.com/watch?v=${vid.id.videoId}`,
    thumbnail: vid.snippet.thumbnails.high.url,
    channel: vid.snippet.channelTitle,
    publishedAt: vid.snippet.publishedAt
  }));
}

Module({
  command: 'yts',
  package: 'search',
  description: 'Search YouTube videos'
})(async (message, match) => {
  if (!match) return await message.send('Please provide a search query');
  const query = match.trim();
  const results = await ytSearch(query, 10);
  if (!results.length) return await message.send('err');
  let reply = `*YouTube results:*"${query}":\n\n`;
  results.forEach((v, i) => {
  const date = new Date(v.publishedAt).toISOString().split('T')[0];
    reply += `⬢ ${i + 1}. ${v.title}\n   Channel: ${v.channel}\n   Published: ${date}\n   Link: ${v.url}\n\n`;
  });

  await message.send({
    image: { url: results[0].thumbnail },
    caption: reply
  });
});
