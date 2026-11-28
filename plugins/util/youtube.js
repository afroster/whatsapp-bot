'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const BASE_URL = 'https://www.youtube.com';
const INNERTUBE_URL = `${BASE_URL}/youtubei/v1`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: '*/*',
    Origin: BASE_URL,
    Referer: BASE_URL
};
const CLIENT = { clientName: 'WEB', clientVersion: '2.20241126.01.00' };

let youtubeiClient;
let youtubeiPromise;

const youtube = {
    BASE_URL,
    INNERTUBE_URL,

    async request(url, options = {}) {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers: { ...HEADERS, ...(options.headers || {}) },
            params: options.params,
            data: options.data,
            responseType: options.responseType || 'json',
            timeout: options.timeout || 30000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });
        return response.data;
    },

    async innertube(endpoint, data = {}) {
        const { params = {}, ...body } = data;
        return this.request(`${INNERTUBE_URL}/${endpoint}`, {
            method: 'POST',
            params: { prettyPrint: false, ...params },
            data: { context: { client: CLIENT }, ...body }
        });
    },

    getVideoId(input) {
        if (!input) return null;
        const value = String(input).trim();
        if (/^[\w-]{11}$/.test(value)) return value;
        try {
            const url = new URL(value);
            const host = url.hostname.replace(/^www\./, '');
            if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
            if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
                const queryId = url.searchParams.get('v');
                if (queryId) return queryId;
                const parts = url.pathname.split('/').filter(Boolean);
                if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) return parts[1] || null;
            }
        } catch {}
        return null;
    },

    getPlaylistId(input) {
        try { return new URL(input).searchParams.get('list'); } catch { return null; }
    },

    getChannelId(input) {
        try {
            const parts = new URL(input).pathname.split('/').filter(Boolean);
            return parts[0] === 'channel' ? parts[1] || null : null;
        } catch { return null; }
    },

    isValidUrl(input) { return Boolean(this.getVideoId(input)); },
    isPlaylistUrl(input) { return Boolean(this.getPlaylistId(input)); },
    normalizeUrl(input) { const id = this.getVideoId(input); return id ? this.getVideoUrl(id) : null; },
    getVideoUrl(id) { return `https://www.youtube.com/watch?v=${id}`; },
    getThumbnailUrl(id, quality = 'maxresdefault') { return `https://i.ytimg.com/vi/${id}/${quality}.jpg`; },
    getThumbnails(id) {
        return {
            default: this.getThumbnailUrl(id, 'default'),
            medium: this.getThumbnailUrl(id, 'mqdefault'),
            high: this.getThumbnailUrl(id, 'hqdefault'),
            standard: this.getThumbnailUrl(id, 'sddefault'),
            max: this.getThumbnailUrl(id, 'maxresdefault')
        };
    },

    parseDuration(value) {
        if (value == null) return 0;
        if (typeof value === 'number') return value;
        const input = String(value).trim();
        if (/^\d+$/.test(input)) return Number(input);
        if (/^P/.test(input)) {
            const m = input.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (!m) return 0;
            return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
        }
        const parts = input.split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        return parts.reduce((total, part) => total * 60 + part, 0);
    },

    formatDuration(seconds) {
        seconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    },

    formatBytes(bytes) {
        if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return 'Unknown';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = Number(bytes), index = 0;
        while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
        return `${size.toFixed(index ? 2 : 0)} ${units[index]}`;
    },

    getText(value) {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (value.simpleText) return value.simpleText;
        if (Array.isArray(value.runs)) return value.runs.map(item => item.text || '').join('');
        return '';
    },

    findRenderers(object, names, output = []) {
        if (!object || typeof object !== 'object') return output;
        if (Array.isArray(object)) {
            for (const item of object) this.findRenderers(item, names, output);
            return output;
        }
        for (const [key, value] of Object.entries(object)) {
            if (names.includes(key) && value) output.push(value);
            if (value && typeof value === 'object') this.findRenderers(value, names, output);
        }
        return output;
    },

    parseSearchResult(renderer) {
        const id = renderer.videoId;
        if (!id) return null;
        const thumbs = renderer.thumbnail?.thumbnails || [];
        return {
            id,
            title: this.getText(renderer.title),
            url: this.getVideoUrl(id),
            thumbnail: thumbs.at(-1)?.url || this.getThumbnailUrl(id),
            duration: this.getText(renderer.lengthText),
            durationSeconds: this.parseDuration(this.getText(renderer.lengthText)),
            views: this.getText(renderer.viewCountText),
            published: this.getText(renderer.publishedTimeText),
            author: this.getText(renderer.ownerText) || this.getText(renderer.shortBylineText),
            channelId: renderer.ownerEndpoint?.browseEndpoint?.browseId || null,
            description: this.getText(renderer.descriptionSnippet),
            isLive: Boolean(renderer.badges?.some(b => JSON.stringify(b).includes('LIVE')))
        };
    },

    async search(query, options = {}) {
        if (!query) throw new Error('Search query is required');
        const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
        const data = await this.innertube('search', { query, params: options.params });
        return this.findRenderers(data, ['videoRenderer', 'reelItemRenderer'])
            .map(item => this.parseSearchResult(item)).filter(Boolean).slice(0, limit);
    },

    async searchVideos(query, limit = 20) { return this.search(query, { limit }); },

    async suggestions(query) {
        const data = await this.request('https://suggestqueries.google.com/complete/search', {
            params: { client: 'firefox', ds: 'yt', q: query }
        });
        return Array.isArray(data?.[1]) ? data[1] : [];
    },

    async getInfo(input) {
        const id = this.getVideoId(input);
        if (!id) throw new Error('Invalid YouTube video URL');
        const data = await this.innertube('player', { videoId: id, contentCheckOk: true, racyCheckOk: true });
        const details = data.videoDetails || {};
        const micro = data.microformat?.playerMicroformatRenderer || {};
        if (data.playabilityStatus?.status !== 'OK') {
            throw new Error(data.playabilityStatus?.reason || `Video unavailable: ${data.playabilityStatus?.status || 'unknown status'}`);
        }
        return {
            id,
            title: details.title || '',
            description: details.shortDescription || '',
            url: this.getVideoUrl(id),
            thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url || this.getThumbnailUrl(id),
            thumbnails: this.getThumbnails(id),
            duration: Number(details.lengthSeconds || 0),
            durationFormatted: this.formatDuration(details.lengthSeconds),
            views: Number(details.viewCount || 0),
            viewsFormatted: details.viewCount || '0',
            author: details.author || '',
            channelId: details.channelId || '',
            keywords: details.keywords || [],
            category: micro.category || '',
            uploadDate: micro.uploadDate || '',
            publishDate: micro.publishDate || '',
            isLive: Boolean(details.isLiveContent),
            isShorts: this.isShorts(input),
            playability: data.playabilityStatus,
            streamingData: data.streamingData || {},
            raw: data
        };
    },

    parseFormats(streaming = {}) {
        return [...(streaming.formats || []), ...(streaming.adaptiveFormats || [])].map(f => ({
            itag: f.itag,
            mimeType: f.mimeType || '',
            container: f.mimeType?.split(';')[0]?.split('/')[1] || '',
            quality: f.qualityLabel || f.quality || '',
            qualityLabel: f.qualityLabel || '',
            width: f.width || 0,
            height: f.height || 0,
            fps: f.fps || 0,
            bitrate: f.bitrate || 0,
            averageBitrate: f.averageBitrate || 0,
            audioBitrate: f.audioBitrate || 0,
            audioQuality: f.audioQuality || '',
            codecs: f.mimeType?.match(/codecs="([^"]+)"/)?.[1] || '',
            contentLength: Number(f.contentLength || 0),
            size: this.formatBytes(f.contentLength),
            hasAudio: Boolean(f.audioQuality || f.audioChannels),
            hasVideo: Boolean(f.width || f.height),
            url: f.url || null
        }));
    },

    async getFormats(input) { return this.parseFormats((await this.getInfo(input)).streamingData); },
    async getAudioFormats(input) { return (await this.getFormats(input)).filter(f => f.hasAudio && !f.hasVideo); },
    async getVideoFormats(input) { return (await this.getFormats(input)).filter(f => f.hasVideo && !f.hasAudio); },
    async getCombinedFormats(input) { return (await this.getFormats(input)).filter(f => f.hasAudio && f.hasVideo); },
    async getQuality(input) {
        return [...new Set((await this.getFormats(input)).filter(f => f.hasVideo).map(f => f.qualityLabel).filter(Boolean))]
            .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    },
    async getAvailableItags(input) { return (await this.getFormats(input)).map(f => f.itag); },
    async getBestAudio(input) {
        return (await this.getAudioFormats(input)).sort((a, b) => (b.audioBitrate || b.bitrate) - (a.audioBitrate || a.bitrate))[0] || null;
    },
    async getBestVideo(input) {
        return (await this.getVideoFormats(input)).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
    },
    async getFormatByItag(input, itag) { return (await this.getFormats(input)).find(f => Number(f.itag) === Number(itag)) || null; },
    async getFormatByQuality(input, quality) {
        const target = String(quality).toLowerCase();
        return (await this.getVideoFormats(input)).find(f => f.qualityLabel.toLowerCase() === target || `${f.height}p` === target) || null;
    },
    async getThumbnail(input, quality = 'maxresdefault') {
        const id = this.getVideoId(input);
        if (!id) throw new Error('Invalid YouTube video URL');
        return this.getThumbnailUrl(id, quality);
    },
    async getChannel(input) {
        const info = await this.getInfo(input);
        return { id: info.channelId, name: info.author, url: `https://www.youtube.com/channel/${info.channelId}` };
    },

    async getPlaylist(input, options = {}) {
        const playlistId = this.getPlaylistId(input) || input;
        if (!playlistId) throw new Error('Playlist ID is required');
        const data = await this.innertube('browse', { browseId: `VL${playlistId}` });
        const videos = this.findRenderers(data, ['playlistVideoRenderer']).map(r => {
            const id = r.videoId;
            if (!id) return null;
            return {
                id,
                title: this.getText(r.title),
                url: this.getVideoUrl(id),
                thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url || this.getThumbnailUrl(id),
                duration: this.getText(r.lengthText),
                author: this.getText(r.shortBylineText)
            };
        }).filter(Boolean);
        const meta = this.findRenderers(data, ['playlistMetadataRenderer'])[0];
        return { id: playlistId, title: this.getText(meta?.title), videos: videos.slice(0, options.limit || 100), total: videos.length, raw: data };
    },

    async getRelated(input) {
        const info = await this.getInfo(input);
        return this.findRenderers(info.raw, ['compactVideoRenderer']).map(r => this.parseSearchResult(r)).filter(Boolean);
    },
    async validate(input) {
        try { const info = await this.getInfo(input); return { valid: true, id: info.id, title: info.title, info }; }
        catch (error) { return { valid: false, error: error.message }; }
    },
    async getTitle(input) { return (await this.getInfo(input)).title; },
    async getDescription(input) { return (await this.getInfo(input)).description; },
    async getViews(input) { return (await this.getInfo(input)).views; },
    async getAuthor(input) { return (await this.getInfo(input)).author; },
    async getVideoDuration(input) { return (await this.getInfo(input)).duration; },
    async getTags(input) { return (await this.getInfo(input)).keywords; },
    async getUploadDate(input) { return (await this.getInfo(input)).uploadDate; },
    async getCategory(input) { return (await this.getInfo(input)).category; },

    async selectFormat(input, options = {}) {
        let formats = await this.getFormats(input);
        if (options.type === 'audio') formats = formats.filter(f => f.hasAudio && !f.hasVideo);
        if (options.type === 'video') formats = formats.filter(f => f.hasVideo && !f.hasAudio);
        if (options.type === 'video+audio') formats = formats.filter(f => f.hasAudio && f.hasVideo);
        if (options.itag) return formats.find(f => Number(f.itag) === Number(options.itag)) || null;
        if (options.quality) {
            const target = String(options.quality).toLowerCase();
            formats = formats.filter(f => f.qualityLabel.toLowerCase() === target || `${f.height}p` === target);
        }
        return formats.sort((a, b) => (b.bitrate || b.audioBitrate) - (a.bitrate || a.audioBitrate))[0] || null;
    },
    sortFormats(formats, sortBy = 'bitrate', order = 'desc') {
        const direction = order === 'asc' ? 1 : -1;
        return [...formats].sort((a, b) => ((a[sortBy] || 0) - (b[sortBy] || 0)) * direction);
    },
    isShorts(input) { try { return new URL(input).pathname.startsWith('/shorts/'); } catch { return false; } },

    async getYtClient() {
        if (youtubeiClient) return youtubeiClient;
        if (youtubeiPromise) return youtubeiPromise;
        youtubeiPromise = (async () => {
            const { Innertube, Platform } = await import('youtubei.js/web');
            Platform.shim.eval = async data => new Function(data.output)();
            youtubeiClient = await Innertube.create({ lang: 'en', location: 'US', retrieve_player: true });
            return youtubeiClient;
        })();
        try { return await youtubeiPromise; }
        catch (error) { youtubeiPromise = null; throw error; }
    },

    async getYtInfo(input) {
        const id = this.getVideoId(input);
        if (!id) throw new Error('Invalid YouTube video URL');
        return (await this.getYtClient()).getInfo(id);
    },

    async getDownloadMetadata(input) {
        const info = await this.getYtInfo(input);
        const basic = info.basic_info || {};
        const streaming = info.streaming_data || {};
        return {
            id: basic.id || this.getVideoId(input),
            title: basic.title || '',
            author: basic.author || '',
            duration: Number(basic.duration || 0),
            thumbnail: basic.thumbnail?.[0]?.url || this.getThumbnailUrl(this.getVideoId(input)),
            formats: this.parseFormats({ formats: streaming.formats || [], adaptiveFormats: streaming.adaptive_formats || [] }),
            raw: info
        };
    },

    async getDownloadFormats(input) {
        const formats = (await this.getDownloadMetadata(input)).formats;
        return {
            audio: formats.filter(f => f.hasAudio && !f.hasVideo),
            video: formats.filter(f => f.hasVideo && !f.hasAudio),
            combined: formats.filter(f => f.hasAudio && f.hasVideo)
        };
    },

    async selectDownloadFormat(input, options = {}) {
        const info = await this.getYtInfo(input);
        return info.chooseFormat({
            type: options.type || 'video+audio',
            quality: options.quality || 'best',
            format: options.format || 'any',
            itag: options.itag
        });
    },

    async getDownloadStream(input, options = {}) {
        const info = await this.getYtInfo(input);
        const webStream = await info.download({
            type: options.type || 'video+audio',
            quality: options.quality || 'best',
            format: options.format || 'any',
            codec: options.codec,
            itag: options.itag,
            language: options.language
        });
        return Readable.fromWeb(webStream);
    },
    async getAudioStream(input, options = {}) { return this.getDownloadStream(input, { ...options, type: 'audio' }); },
    async getVideoStream(input, options = {}) { return this.getDownloadStream(input, { ...options, type: 'video+audio' }); },
    async getVideoOnlyStream(input, options = {}) { return this.getDownloadStream(input, { ...options, type: 'video' }); },

    sanitizeFilename(filename) {
        return String(filename || 'youtube').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'youtube';
    },

    async download(input, options = {}) {
        if (options.type === 'audio') return this.downloadAudio(input, options);
        const id = this.getVideoId(input);
        if (!id) throw new Error('Invalid YouTube video URL');
        const metadata = await this.getDownloadMetadata(input);
        const outputDir = path.resolve(options.outputDir || './downloads');
        await fs.promises.mkdir(outputDir, { recursive: true });
        const extension = options.extension || 'mp4';
        const name = this.sanitizeFilename(options.filename || `${metadata.title || id}.${extension}`);
        const filename = path.extname(name) ? name : `${name}.${extension}`;
        const output = path.resolve(outputDir, filename);
        if (!output.startsWith(`${outputDir}${path.sep}`)) throw new Error('Invalid output filename');
        const stream = await this.getDownloadStream(input, options);
        await pipeline(stream, fs.createWriteStream(output));
        const stat = await fs.promises.stat(output);
        return { id, title: metadata.title, filename: path.basename(output), filepath: output, size: stat.size, formattedSize: this.formatBytes(stat.size), type: options.type || 'video+audio', format: extension };
    },

    async downloadAudio(input, options = {}) {
        const id = this.getVideoId(input);
        if (!id) throw new Error('Invalid YouTube video URL');
        if (!ffmpegPath) throw new Error('FFmpeg binary was not found. Reinstall ffmpeg-static for this platform.');
        const outputDir = path.resolve(options.outputDir || './downloads');
        await fs.promises.mkdir(outputDir, { recursive: true });
        const metadata = await this.getDownloadMetadata(input);
        const base = this.sanitizeFilename(options.filename ? path.basename(options.filename, path.extname(options.filename)) : metadata.title || id);
        const filename = `${base}.mp3`;
        const output = path.resolve(outputDir, filename);
        const temporary = `${output}.part`;
        if (!output.startsWith(`${outputDir}${path.sep}`)) throw new Error('Invalid output filename');
        const stream = await this.getAudioStream(input, { quality: options.quality || 'best', format: 'any', language: options.language });
        const bitrate = options.bitrate || '192k';
        try {
            await new Promise((resolve, reject) => {
                ffmpeg(stream)
                    .noVideo()
                    .audioCodec('libmp3lame')
                    .audioBitrate(bitrate)
                    .format('mp3')
                    .on('error', reject)
                    .on('end', resolve)
                    .save(temporary);
            });
            await fs.promises.rename(temporary, output);
        } catch (error) {
            await fs.promises.rm(temporary, { force: true });
            throw error;
        }
        const stat = await fs.promises.stat(output);
        return { id, title: metadata.title, filename, filepath: output, size: stat.size, formattedSize: this.formatBytes(stat.size), format: 'mp3', bitrate };
    },

    async downloadVideo(input, options = {}) {
        return this.download(input, { ...options, type: 'video+audio', extension: 'mp4' });
    },
    async downloadVideoOnly(input, options = {}) {
        return this.download(input, { ...options, type: 'video', extension: 'mp4' });
    },
    async downloadByItag(input, itag, options = {}) { return this.download(input, { ...options, itag: Number(itag) }); },
    async downloadTo(input, output, options = {}) {
        if (options.type === 'audio') {
            return this.downloadAudio(input, { ...options, outputDir: path.dirname(path.resolve(output)), filename: path.basename(output) });
        }
        const destination = path.resolve(output);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await pipeline(await this.getDownloadStream(input, options), fs.createWriteStream(destination));
        const stat = await fs.promises.stat(destination);
        return { filepath: destination, filename: path.basename(destination), size: stat.size, formattedSize: this.formatBytes(stat.size) };
    }
};

module.exports = youtube;
