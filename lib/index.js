const {
  default: makeWASocket,
  Browsers,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore
} = require('baileys');

const pino = require('pino');
const path = require('path');
const config = require('../../config.js');
const fs = require('fs');
const serialize = require('./dPath/serialize');

const {
  load_plugins,
  handleMessage,
  dispatchEvents,
  plugins
} = require('./plugins');

class Main {
  constructor(options = {}) {
    this.options = {
      session: path.resolve(__dirname, 'Session'),
      reconnectDelay: 3000,
      ...options
    };

    this.conn = null;
    this.pluginsLoaded = false;
    this.groupCache = new Map();
    this.reconnecting = false;
  }

  async connect() {
    fs.mkdirSync(this.options.session, { recursive: true });

    const logger = pino({ level: 'silent' });

    const { state, saveCreds } = await useMultiFileAuthState(
      this.options.session
    );

    this.conn = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: Browsers.macOS('Chrome'),
      logger,
      downloadHistory: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: true
    });

    this.conn.ev.on('connection.update', update =>
      this.connectionUpdate(update)
    );

    this.conn.ev.on('creds.update', saveCreds);

    this.conn.ev.on('group-participants.update', update =>
      this.groupParticipants(update)
    );

    this.conn.ev.on('call', call =>
      this.handleCalls(call)
    );

    this.conn.ev.on('messages.upsert', update =>
      this.messagesUpsert(update)
    );

    return this.conn;
  }

  async connectionUpdate(update) {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('ragnar bot connected');

      if (!this.pluginsLoaded) {
        load_plugins();
        this.pluginsLoaded = true;
      }

      await this.conn.sendMessage(this.conn.user.id, {
        image: {
          url: 'https://files.catbox.moe/lq7nwm.jpg'
        },
        caption: `
*PREFIX:* ${config.prefix || process.env.PREFIX}
*MODE:* ${config.WORK_TYPE || process.env.WORK_TYPE}
*SUDO:* ${process.env.SUDO}
*Made with❤️*`
      });
    }

    if (connection === 'close') {
      console.log(lastDisconnect?.error);

      this.pluginsLoaded = false;

      if (!this.reconnecting) {
        this.reconnecting = true;

        setTimeout(async () => {
          this.reconnecting = false;

          try {
            await this.connect();
          } catch (error) {
            console.error(`[RECONNECT ERROR] ${error.message}`);
          }
        }, this.options.reconnectDelay);
      }
    }
  }

  async groupParticipants({ id, action }) {
    const key = `${id}:${action}`;
    if (this.groupCache.has(key)) return;
    this.groupCache.set(key, Date.now());
    setTimeout(() => this.groupCache.delete(key), 5000);
  }

  async handleCalls(call) {
    for (const c of call) {
      if (!c.isOffer) continue;
      try {
        await this.conn.rejectCall(c.callId, c.from);

        await this.conn.sendMessage(c.from, {
          text: 'Sorry, I do not accept calls'
        });
      } catch {}
    }
  }

  async messagesUpsert({ messages, type }) {
    if (type !== 'notify' || !messages?.length) return;
    if (!this.pluginsLoaded) return;

    for (const raw of messages) {
      if (!raw.message) continue;

      try {
        const message = await serialize(raw, this.conn);
        if (!message || !message.body) continue;

        console.log(`
User: ${message.sender}
Message: ${message.body}
From: ${message.from}
`);

        const mode = config.WORK_TYPE ||
          process.env.WORK_TYPE ||
          'public';

        if (mode === 'private' && !plugins.isOwner(message)) {
          continue;
        }

        const prefix = config.prefix || process.env.PREFIX;
        const handled = await handleMessage(message, prefix);
        if (handled) continue;

        await dispatchEvents(message, 'text');

      } catch (error) {
        console.error(
          `\x1b[31m[MESSAGE ERROR]\x1b[0m ${error.message}`
        );
      }
    }
  }
}

const main = new Main();

module.exports = {
  Main,
  main,
  connect: main.connect.bind(main)
};
        
