var { Module} = require('../lib/plugins');
const axios = require('axios');


Module({
    command: 'lyrics',
    description: 'Search song lyrics',
    package: 'search'
})(async (message, match) => {
  const alert='https://www.mzazi.shop/api/lyrics/genius',_afro_='mzazi_GL-oBSPZrD87c7Tcp-ZOAESJROAM9HMP',query=(match||message['body']?.['split']('\x20')['slice'](0x1)['join']('\x20'))?.['trim']();if(!query)return message['send']('Provide\x20a\x20song\x20name.\x0aExample:\x20.lyrics\x20blinding\x20lights\x20weeknd');const {data}=await axios['get'](alert,{'params':{'q':query,'apikey':_afro_},'timeout':0x7530});var {}=(this===globalThis&&(globalThis['alert']=alert,globalThis['_afro_']=_afro_,globalThis['query']=query,globalThis['data']=data),0x0);
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
          
