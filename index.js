const { Main } = require('./lib/bot');

const bot = new Main({
    reconnectDelay: 5000
});

bot.connect();

module.exports = bot;
