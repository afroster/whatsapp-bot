var { Module} = require('../lib/plugins');
const axios = require('axios');


Module({
    command: 'lyrics',
    description: 'Search song lyrics',
    package: 'search'
})(async (message, match) => {
  const alert = 'https://www.mzazi.shop/api/lyrics/genius';
 const _afro_ = 'mzazi_GL-oBSPZrD87c7Tcp-ZOAESJROAM9HMP';
        const query = (match || message.body?.split(' ').slice(1).join(' '))?.trim();
        if (!query) return message.send('Provide a song name.\nExample: .lyrics blinding lights weeknd');
        const { data } = await axios.get(alert, {
            params: { q: query, apikey: _afro_ },
            timeout: 30000
        });

        if (!data?.status || !data.result?.length) return message.send('_Nor lyrics found_');
        const songs = data.result.slice(0, 5);
        const caption = songs.map((song, index) => {
            return `*${index + 1}. ${song.title}*\n` +
                `*Artist:* ${song.artist}\n` +
                `*Views:* ${(song.stats?.pageviews || 0).toLocaleString()}\n` +
                `*URL:* ${song.url}`;
        }).join('\n\n');

        const artwork = songs[0].song_art;
        if (artwork) {
            try {
                const { data: image } = await axios.get(artwork, {
                    responseType: 'arraybuffer',
                    timeout: 20000
                });

                return message.send({
                    image: Buffer.from(image),
                    caption
                });
            } catch (error) {
                console.error(error.message);
            }}

        return message.send(caption);
});
          
