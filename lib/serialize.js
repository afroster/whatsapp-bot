const axios = require("axios");
const Jimp = require("jimp");
const path = require("path");
const fs = require("fs");
const { getContentType, downloadContentFromMessage, jidNormalizedUser } = require("baileys");

const groupCache = new Map();

const config = require("../config");

const LIMITS = {
    rowTitle: 72,
    rowDesc: 72,
    sectionTitle: 24,
    buttonText: 20,
    listButton: 20
};

const clip = (value, limit) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
};

const ui = {
    enabled: () => config.BUTTONS === true,

    cmd: (name, ...args) => {
        const prefix = config.prefix || ".";
        return [`${prefix}${name}`, ...args.filter(value =>
            value !== undefined && value !== null && value !== ""
        )].join(" ").trim();
    }
};

async function loadBaileys() {
    try {
        return await import("baileys");
    } catch {
        return require("baileys");
    }
}

async function toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) return Buffer.from(input);

    if (input && input.url) {
        if (typeof input.url === "string" && /^https?:\/\//i.test(input.url)) {
            const response = await axios.get(input.url, {
                responseType: "arraybuffer"
            });
            return Buffer.from(response.data);
        }

        if (typeof input.url === "string" && fs.existsSync(input.url)) {
            return fs.readFileSync(input.url);
        }

        if (Buffer.isBuffer(input.url)) return input.url;
    }

    if (typeof input === "string" && fs.existsSync(input)) {
        return fs.readFileSync(input);
    }

    const stream = input?.stream || (typeof input?.pipe === "function" ? input : null);

    if (stream?.[Symbol.asyncIterator]) {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }

    const data = input && (input.data || input.buffer);

    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.from(data);
    if (data instanceof Uint8Array) return Buffer.from(data);

    return null;
}

function buildInteractiveButtons(buttons = []) {
    return buttons.map((button, index) => {
        if (button?.name && button.buttonParamsJson) return button;

        if (button?.id || button?.text) {
            return {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: button.text || `Button ${index + 1}`,
                    id: button.id || `quick_${index + 1}`
                })
            };
        }

        if (button?.url) {
            return {
                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                    display_text: clip(button.text, LIMITS.buttonText),
                    url: button.url,
                    merchant_url: button.url
                })
            };
        }

        if (button?.copy !== undefined) {
            return {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                    display_text: clip(button.text, LIMITS.buttonText),
                    copy_code: button.copy
                })
            };
        }

        return button;
    });
}

function validateButtons(buttons = []) {
    if (!Array.isArray(buttons)) {
        throw new Error("Buttons must be an array");
    }

    if (!buttons.length) {
        throw new Error("At least one button is required");
    }

    if (buttons.length > 25) {
        throw new Error("Maximum 25 btn");
    }

    return buildInteractiveButtons(buttons);
}

async function prepareHeaderMedia(conn, opts) {
    const { prepareWAMessageMedia } = await loadBaileys();
    const upload = {
        upload: conn.waUploadToServer
    };

    try {
        if (opts.image) {
            const image = /^https?:\/\//i.test(opts.image)
                ? { url: opts.image }
                : await toBuffer(opts.image);

            return await prepareWAMessageMedia({ image }, upload);
        }

        if (opts.video) {
            const video = /^https?:\/\//i.test(opts.video)
                ? { url: opts.video }
                : await toBuffer(opts.video);

            return await prepareWAMessageMedia({ video }, upload);
        }

        if (opts.document) {
            const document = /^https?:\/\//i.test(opts.document)
                ? { url: opts.document }
                : await toBuffer(opts.document);

            return await prepareWAMessageMedia({ document }, upload);
        }
    } catch (error) {
        console.error("Interactive media error:", error.message);
    }

    return null;
}

async function sendInteractive(conn, jid, opts, buttons, quoted) {
    const { generateWAMessageFromContent } = await loadBaileys();

    const media = await prepareHeaderMedia(conn, opts);

    const content = {
        body: {
            text: opts.text || ""
        },
        footer: {
            text: opts.footer || ""
        },
        header: media
            ? {
                title: opts.header || "",
                hasMediaAttachment: true,
                ...media
            }
            : {
                title: opts.header || "",
                hasMediaAttachment: false
            },
        nativeFlowMessage: {
            buttons: validateButtons(buttons)
        }
    };

    if (opts.contextInfo) {
        content.contextInfo = opts.contextInfo;
    }

    const messageContent = {
        interactiveMessage: content
    };

    const userJid = conn.user?.id || conn.user?.jid;

    const waMessage = generateWAMessageFromContent(
        jid,
        messageContent,
        {
            quoted: quoted || undefined,
            userJid
        }
    );

    const additionalNodes = [{
        tag: "biz",
        attrs: {},
        content: [{
            tag: "interactive",
            attrs: {
                type: "native_flow",
                v: "1"
            },
            content: [{
                tag: "native_flow",
                attrs: {
                    v: "9",
                    name: "mixed"
                }
            }]
        }]
    }];

    await conn.relayMessage(jid, waMessage.message, {
        messageId: waMessage.key.id,
        additionalNodes
    });

    return waMessage;
}

async function sendLegacyList(conn, jid, opts, quoted) {
    const { generateWAMessageFromContent } = await loadBaileys();

    const sections = (opts.sections || [])
        .filter(section => section.rows?.length)
        .map(section => ({
            title: clip(section.title, LIMITS.sectionTitle),
            rows: section.rows.map(row => ({
                title: clip(row.title, LIMITS.rowTitle),
                ...(row.description
                    ? { description: clip(row.description, LIMITS.rowDesc) }
                    : {}),
                rowId: row.id
            }))
        }));

    if (!sections.length) {
        throw new Error("A list needs at least one row");
    }

    const listMessage = {
        title: opts.header || "",
        description: opts.body ?? opts.text ?? "",
        buttonText: clip(opts.button || "Select", LIMITS.listButton),
        footerText: opts.footer || "",
        listType: 1,
        sections
    };

    const waMessage = generateWAMessageFromContent(
        jid,
        { listMessage },
        {
            quoted: quoted || undefined,
            userJid: conn.user?.id || conn.user?.jid
        }
    );

    await conn.relayMessage(jid, waMessage.message, {
        messageId: waMessage.key.id,
        additionalNodes: [{
            tag: "biz",
            attrs: {},
            content: [{
                tag: "list",
                attrs: {
                    v: "2",
                    type: "product_list"
                }
            }]
        }]
    });

    return waMessage;
}

async function sendUI(conn, jid, opts, quoted, type) {
    const fallback = async () => {
        const content = { text: opts.text || opts.body || "" };
        if (opts.image) {
            const image = /^https?:\/\//i.test(opts.image)
                ? { url: opts.image }
                : await toBuffer(opts.image);

            return conn.sendMessage(jid, {
                image,
                caption: content.text
            }, { quoted: quoted || undefined });
        }

        return conn.sendMessage(jid, content, {
            quoted: quoted || undefined
        });
    };

    if (!ui.enabled()) return fallback();

    try {
        if (type === "list") {
            return await sendLegacyList(conn, jid, opts, quoted);
        }

        return await sendInteractive(
            conn,
            jid,
            opts,
            opts.buttons,
            quoted
        );
    } catch (error) {
        console.error("[ui] Interactive send failed:", error.message);
        return fallback();
    }
}

async function makePp(buf) {
    const img = await Jimp.read(buf);
    const w = img.getWidth();
    const h = img.getHeight();
    const crop = img.crop(0, 0, w, h);

    return {
        img: await crop.scaleToFit(324, 720).getBufferAsync(Jimp.MIME_JPEG),
        prev: await crop.normalize().getBufferAsync(Jimp.MIME_JPEG)
    };
}

const serialize = async (msg, conn) => {
    const key = msg.key;
    const from = key.remoteJid;
    const fromMe = key.fromMe;
    const sender = fromMe
        ? jidNormalizedUser(conn.user.id)
        : jidNormalizedUser(key.participant || from);

    const isGroup = from.endsWith("@g.us");
    const pushName = msg.pushName || "gafield";
    const type = getContentType(msg.message);
    const content = msg.message[type];

    const extractBody = () => {
        return type === "conversation" ? content :
            type === "extendedTextMessage" ? content.text :
            type === "imageMessage" ? content.caption :
            type === "videoMessage" ? content.caption :
            type === "templateButtonReplyMessage" ? content.selectedDisplayText :
            type === "listResponseMessage" ? content.singleSelectReply?.selectedRowId :
            type === "buttonsResponseMessage" ? content.selectedButtonId :
            type === "interactiveResponseMessage" ? content.nativeFlowResponseMessage?.paramsJson :
            "";
    };

    const extractQuoted = () => {
        const context = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = context?.quotedMessage;

        if (!quotedMsg) return null;

        const qt = getContentType(quotedMsg);
        const qContent = quotedMsg[qt];

        const b =
            qt === "conversation" ? qContent :
            qt === "extendedTextMessage" ? qContent.text :
            qt === "imageMessage" ? qContent.caption :
            qt === "videoMessage" ? qContent.caption :
            qt === "templateButtonReplyMessage" ? qContent.selectedDisplayText :
            qt === "buttonsResponseMessage" ? qContent.selectedButtonId :
            "";

        return {
            type: qt,
            msg: qContent,
            body: b,
            fromMe: context.participant === conn.user.id,
            participant: context.participant,
            id: context.stanzaId,
            key: {
                remoteJid: from,
                fromMe: context.participant === conn.user.id,
                id: context.stanzaId,
                participant: context.participant
            },
            download: async () => {
                const stream = await downloadContentFromMessage(
                    qContent,
                    qt.replace("Message", "")
                );

                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);

                return Buffer.concat(chunks);
            }
        };
    };

    const msgObj = {
        raw: msg,
        conn,
        key,
        id: key.id,
        from,
        jid: from,
        fromMe,
        sender,
        isGroup,
        pushName,
        type,
        body: extractBody(),
        content,
        quoted: extractQuoted(),
        mentions: msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
        ui
    };

    msgObj.loadGroupInfo = async () => {
        if (!msgObj.isGroup) return;

        const cached = groupCache.get(msgObj.from);
        const now = Date.now();

        if (cached && now - cached.timestamp < 5 * 60 * 1000) {
            msgObj.groupMetadata = cached.data;
        } else {
            const meta = await conn.groupMetadata(msgObj.from);
            groupCache.set(msgObj.from, {
                data: meta,
                timestamp: now
            });
            msgObj.groupMetadata = meta;
        }

        msgObj.groupParticipants = msgObj.groupMetadata.participants;
        msgObj.groupAdmins = msgObj.groupParticipants.filter(p => p.admin).map(p => p.id);
        msgObj.groupOwner = msgObj.groupMetadata.owner || msgObj.groupAdmins[0];
        msgObj.joinApprovalMode = msgObj.groupMetadata.joinApprovalMode || false;
        msgObj.memberAddMode = msgObj.groupMetadata.memberAddMode || false;
        msgObj.announce = msgObj.groupMetadata.announce || false;
        msgObj.restrict = msgObj.groupMetadata.restrict || false;
        msgObj.isAdmin = msgObj.groupAdmins.includes(msgObj.sender);
        msgObj.isBotAdmin = msgObj.groupAdmins.includes(jidNormalizedUser(conn.user.id));
    };

    msgObj.muteGroup = () => conn.groupSettingUpdate(msgObj.from, "announcement");
    msgObj.unmuteGroup = () => conn.groupSettingUpdate(msgObj.from, "not_announcement");
    msgObj.setSubject = text => conn.groupUpdateSubject(msgObj.from, text);
    msgObj.setDescription = text => conn.groupUpdateDescription(msgObj.from, text);
    msgObj.addParticipant = jid => conn.groupParticipantsUpdate(msgObj.from, [jid], "add");
    msgObj.removeParticipant = jid => conn.groupParticipantsUpdate(msgObj.from, [jid], "remove");
    msgObj.promoteParticipant = jid => conn.groupParticipantsUpdate(msgObj.from, [jid], "promote");
    msgObj.demoteParticipant = jid => conn.groupParticipantsUpdate(msgObj.from, [jid], "demote");
    msgObj.leaveGroup = () => conn.groupLeave(msgObj.from);
    msgObj.inviteCode = () => conn.groupInviteCode(msgObj.from);
    msgObj.revokeInvite = () => conn.groupRevokeInvite(msgObj.from);
    msgObj.getInviteInfo = code => conn.groupGetInviteInfo(code);
    msgObj.joinViaInvite = code => conn.groupAcceptInvite(code);
    msgObj.getJoinRequests = () => conn.groupRequestParticipantsList(msgObj.from);
    msgObj.updateJoinRequests = (jids, action = "approve") =>
        conn.groupRequestParticipantsUpdate(msgObj.from, jids, action);
    msgObj.setMemberAddMode = (enable = true) =>
        conn.groupSettingUpdate(msgObj.from, enable ? "not_announcement" : "announcement");
    msgObj.fetchStatus = jid => conn.fetchStatus(jid);
    msgObj.profilePictureUrl = jid => conn.profilePictureUrl(jid);
    msgObj.blockUser = jid => conn.updateBlockStatus(jid, "block");
    msgObj.unblockUser = jid => conn.updateBlockStatus(jid, "unblock");
    msgObj.getParticipants = () => msgObj.groupParticipants || [];
    msgObj.isParticipant = jid => msgObj.getParticipants().some(p => p.id === jid);

    msgObj.download = async () => {
        const stream = await downloadContentFromMessage(
            msgObj.content,
            msgObj.type.replace("Message", "")
        );

        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);

        return Buffer.concat(chunks);
    };

    msgObj.send = async (payload, options = {}) => {
        if (payload?.delete) {
            return conn.sendMessage(msgObj.from, {
                delete: payload.delete
            });
        }

        let content;

        if (typeof payload === "string") {
            content = { text: payload };
        } else if (payload.video) {
            content = {
                video: payload.video,
                caption: payload.caption || "",
                mimetype: payload.mimetype || "video/mp4"
            };
        } else {
            content = payload;
        }

        if (options.edit) content.edit = options.edit;

        return conn.sendMessage(msgObj.from, content, {
            quoted: msgObj.raw
        });
    };

    msgObj.sendReply = async text => {
        return conn.sendMessage(msgObj.from, {
            text
        }, {
            quoted: msgObj.raw
        });
    };

    msgObj.sendList = opts =>
        sendUI(conn, msgObj.from, opts, msgObj.raw, "list");

    msgObj.sendButtons = opts =>
        sendUI(conn, msgObj.from, opts, msgObj.raw, "buttons");

    msgObj.edit = (text, jid = msgObj.from, editKey) => {
        return conn.sendMessage(jid, {
            text,
            edit: editKey
        });
    };

    msgObj.react = emoji => {
        return conn.sendMessage(msgObj.from, {
            reactionMessage: {
                text: emoji,
                key: msgObj.key
            }
        });
    };

    msgObj.sendFromUrl = async (url, opts = {}) => {
        const response = await axios.get(url, {
            responseType: "arraybuffer"
        });

        const buffer = Buffer.from(response.data);

        if (opts.asSticker) {
            return msgObj.send({ sticker: buffer });
        }

        if (opts.asDocument) {
            return msgObj.send({
                document: buffer,
                mimetype: "application/octet-stream",
                fileName: opts.fileName || "file"
            });
        }

        return msgObj.send({ image: buffer });
    };

    msgObj.setPp = async (jid, buf) => {
        const { query } = conn;
        const { img } = await makePp(buf);

        await query({
            tag: "iq",
            attrs: {
                to: "@s.whatsapp.net",
                type: "set",
                xmlns: "w:profile:picture"
            },
            content: [{
                tag: "picture",
                attrs: {
                    type: "image"
                },
                content: img
            }]
        });
    };

    return msgObj;
};

module.exports = serialize;
