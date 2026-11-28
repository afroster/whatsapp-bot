const {
    default: makeWASocket,
    Browsers,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore
} = require('baileys');

const pino = require('pino');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const serialize = require('./serialize');

const Logger = require('./Features/logging');
const BotEvents = require('./Features/events');
const Scheduler = require('./Features/scheduler');

const {
    load_plugins,
    handleMessage,
    dispatchEvents,
    isOwner
} = require('./plugins');

class Main {
    constructor(options = {}) {
        this.id = crypto.randomUUID();
        this.logger = new Logger('Ragnar');
        this.events = new BotEvents();
        this.scheduler = new Scheduler();

        this.sessionPath = path.resolve(
            __dirname,
            'Session'
        );

        this.reconnectDelay = options.reconnectDelay || 3000;

        this.conn = null;
        this.pluginsLoaded = false;
        this.reconnecting = false;
        this.groupCache = new Map();
        this.reconnectTimer = null;
    }

    async connect() {
        if (this.conn) return this.conn;

        fs.mkdirSync(this.sessionPath, {
            recursive: true
        });

        const logger = pino({
            level: 'silent'
        });

        const { state, saveCreds } =
            await useMultiFileAuthState(this.sessionPath);

        const conn = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    logger
                )
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

        this.conn = conn;

        conn.ev.on('creds.update', saveCreds);

        conn.ev.on('connection.update', update => {
            this.connectionUpdate(update);
        });

        conn.ev.on('messages.upsert', update => {
            this.messagesUpsert(update);
        });

        conn.ev.on('group-participants.update', update => {
            this.groupParticipants(update);
        });

        conn.ev.on('call', calls => {
            this.handleCalls(calls);
        });

        this.events.emitEvent('connecting', conn);

        return conn;
    }

    async connectionUpdate(update) {
        const { connection, lastDisconnect } = update;
        if (connection === 'connecting') {
            this.logger.info('Connecting to WhatsApp...');
        }

        if (connection === 'open') {
            this.reconnecting = false;
            this.logger.success('WhatsApp connected');
            if (!this.pluginsLoaded) {
                await load_plugins();

                this.pluginsLoaded = true;

                this.logger.success('Plugins loaded');
            }

            this.events.emitEvent('ready', this.conn);
            await this.conn.sendMessage(this.conn.user.id, {
                image: {
                    url: 'https://files.catbox.moe/lq7nwm.jpg'
                },
                caption: `
*Ragnar CONNECTED*

*PREFIX:* ${config.prefix || process.env.PREFIX}
*MODE:* ${config.WORK_TYPE || process.env.WORK_TYPE}
*SUDO:* ${process.env.SUDO || 'Not set'}

*Made with ❤️*
`
            });
        }

        if (connection === 'close') {
            this.logger.warn('WhatsApp connection closed');
            this.logger.error(
                lastDisconnect?.error?.message || 'unknown connection error'
            );

            this.events.emitEvent('close', lastDisconnect);
            this.conn = null;
            if (!this.reconnecting) {
                this.reconnecting = true;

                this.logger.info(
                    `Reconnecting in ${this.reconnectDelay / 1000} seconds...`
                );

                this.reconnectTimer = setTimeout(() => {
                    this.reconnecting = false;
                    this.connect();
                }, this.reconnectDelay);
            }
        }
    }

    async messagesUpsert({ messages, type }) {
        if (type !== 'notify' || !messages?.length) return;
        if (!this.pluginsLoaded || !this.conn) return;

        for (const raw of messages) {
            if (!raw.message) continue;

            const message = await serialize(raw, this.conn);
            if (!message || !message.body) continue;
            this.logger.command(
                `${message.sender}: ${message.body}`
            );

            const mode = config.WORK_TYPE || process.env.WORK_TYPE;
            const isPublic = mode === 'public';
            const isPrivate = mode === 'private';

            if (!isPublic && !(isPrivate && isOwner(message))) {
                continue;
            }

            const prefix = config.prefix || process.env.PREFIX;
            await handleMessage(message, prefix);
            await dispatchEvents(message, 'text');
            this.events.emitEvent('message', message);
        }
    }

    async groupParticipants(update) {
        const { id, participants, action } = update;

        const key = `${id}:${action}`;

        if (this.groupCache.has(key)) return;

        this.groupCache.set(key, Date.now());

        setTimeout(() => {
            this.groupCache.delete(key);
        }, 5000);

        this.events.emitEvent(
            'group-participants.update',
            update
        );

        this.logger.info(
            `Group event: ${action} | ${participants.length} participant(s)`
        );
    }

    async handleCalls(calls) {
        for (const call of calls) {
            if (!call.isOffer) continue;
            const callerJid = call.from;
            await this.conn.rejectCall(
                call.callId,
                callerJid
            );

            await this.conn.sendMessage(callerJid, {
                text: 'Sorry, I do not accept calls'
            });

            this.logger.warn(`Rejected call from ${callerJid}`);
        }
    }

    async disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.scheduler.stopAll();
        if (this.conn) {
            this.conn.end(undefined);
            this.conn = null;
        }

        this.reconnecting = false;

        this.logger.warn('Bot disconnected');
        this.events.emitEvent('disconnect');
    }
}

module.exports = { Main };               
