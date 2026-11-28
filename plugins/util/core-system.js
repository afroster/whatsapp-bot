
const axios = require('axios');

const BASE_URL = 'https://www.youtube.com';
const INNERTUBE_URL = `${BASE_URL}/youtubei/v1`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': '*/*',
    'Origin': BASE_URL,
    'Referer': BASE_URL
};

const youtube = {
    BASE_URL,
  
    async request(url, options = {}) {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers: {
                ...HEADERS,
                ...(options.headers || {})
            },
            params: options.params,
            data: options.data,
            timeout: options.timeout || 30000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });

        return response.data;
    },

    async innertube(endpoint, data = {}) {
        const response = await this.request(
            `${INNERTUBE_URL}/${endpoint}?prettyPrint=false`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                data: {
                    context: {
                        client: {
                            clientName: 'WEB',
                            clientVersion: '2.20241126.01.00',
                            hl: 'en',
                            gl: 'US'
                        }
                    },
                    ...data
                }
            }
        );

        return response;
    },

    // ==============================
    // URL Core
    // ==============================

    getVideoId(url) {
        try {
            if (!url) return null;

            const parsed = new URL(url);

            if (
                parsed.hostname === 'youtu.be' ||
                parsed.hostname === 'www.youtu.be'
            ) {
                return parsed.pathname.split('/')[1] || null;
            }

            if (
                !parsed.hostname.endsWith('youtube.com') &&
                !parsed.hostname.endsWith('youtube-nocookie.com')
            ) {
                return null;
            }

            return (
                parsed.searchParams.get('v') ||
                parsed.pathname.match(
                    /\/(?:shorts|embed|live|v)\/([^/?]+)/
                )?.[1] ||
                null
            );
        } catch {
            return null;
        }
    },

    getPlaylistId(url) {
        try {
            return new URL(url).searchParams.get('list');
        } catch {
            return null;
        }
    },

    getChannelId(url) {
        try {
            const parsed = new URL(url);

            return parsed.pathname.match(
                /\/channel\/([^/]+)/
            )?.[1] || null;
        } catch {
            return null;
        }
    },

    isValidUrl(url) {
        return Boolean(this.getVideoId(url));
    },

    isPlaylistUrl(url) {
        return Boolean(this.getPlaylistId(url));
    },

    normalizeUrl(url) {
        const id = this.getVideoId(url);
        if (!id) throw new Error('Invalid YouTube URL');

        return `${BASE_URL}/watch?v=${id}`;
    },

    getVideoUrl(id) {
        if (!id) throw new Error('Video ID is required');
        return `${BASE_URL}/watch?v=${id}`;
    },

    getThumbnailUrl(id, quality = 'hqdefault') {
        const qualities = [
            'default',
            'mqdefault',
            'hqdefault',
            'sddefault',
            'maxresdefault'
        ];

        if (!id) return null;

        if (!qualities.includes(quality)) {
            quality = 'hqdefault';
        }

        return `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
    },

    getThumbnails(id) {
        if (!id) return [];

        return [
            'default',
            'mqdefault',
            'hqdefault',
            'sddefault',
            'maxresdefault'
        ].map(quality => ({
            quality,
            url: this.getThumbnailUrl(id, quality)
        }));
    },

  
    parseDuration(duration) {
        if (typeof duration === 'number') {
            return duration;
        }

        if (!duration) return 0;

        if (/^\d+$/.test(String(duration))) {
            return Number(duration);
        }

        const parts = String(duration).split(':').map(Number);

        if (parts.some(Number.isNaN)) return 0;

        return parts.reduce(
            (total, value) => total * 60 + value,
            0
        );
    },

    formatDuration(seconds) {
        seconds = Number(seconds) || 0;

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remaining = Math.floor(seconds % 60);

        return hours
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
            : `${minutes}:${String(remaining).padStart(2, '0')}`;
    },

    
    formatBytes(bytes) {
        if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) {
            return 'Unknown';
        }

        if (bytes === 0) return '0 Bytes';

        const units = [
            'Bytes',
            'KB',
            'MB',
            'GB',
            'TB'
        ];

        const index = Math.min(
            Math.floor(Math.log(bytes) / Math.log(1024)),
            units.length - 1
        );

        return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
    },

    // ==============================
    // VIDEO SEARCH
    // ==============================

    async search(query, options = {}) {
        if (!query) throw new Error('Search query is required');

        const data = await this.innertube('search', {
            query,
            params: options.params
        });

        const contents =
            data.contents?.twoColumnSearchResultsRenderer
                ?.primaryContents?.sectionListRenderer
                ?.contents || [];

        const results = [];

        const extract = items => {
            for (const item of items || []) {
                if (item.videoRenderer) {
                    const video = item.videoRenderer;

                    results.push({
                        id: video.videoId,
                        title: this.getText(video.title),
                        description: this.getText(video.descriptionSnippet),
                        url: this.getVideoUrl(video.videoId),
                        thumbnail: video.thumbnail?.thumbnails?.at(-1)?.url,
                        duration: this.getText(video.lengthText),
                        views: this.getText(video.viewCountText),
                        published: this.getText(video.publishedTimeText),
                        channel: this.getText(video.ownerText),
                        channelId: video.ownerText?.runs?.[0]?.navigationEndpoint
                            ?.browseEndpoint?.browseId || null,
                        type: 'video'
                    });
                }

                if (item.shelfRenderer) {
                    extract(item.shelfRenderer.content?.verticalListRenderer?.items);
                }

                if (item.itemSectionRenderer) {
                    extract(item.itemSectionRenderer.contents);
                }
            }
        };

        for (const section of contents) {
            extract(section.itemSectionRenderer?.contents);
        }

        return results.slice(0, options.limit || 20);
    },

    async searchVideos(query, limit = 20) {
        return this.search(query, { limit });
    },

    // ==============================
    // TEXT PARSING
    // ==============================

    getText(object) {
        if (!object) return null;

        if (typeof object === 'string') return object;

        if (object.simpleText) {
            return object.simpleText;
        }

        if (object.runs) {
            return object.runs.map(run => run.text).join('');
        }

        return null;
    },

    // ==============================
    // VIDEO INFORMATION
    // ==============================

    async getInfo(url) {
        const id = this.getVideoId(url);

        if (!id) throw new Error('Invalid YouTube URL');

        const data = await this.innertube('player', {
            videoId: id
        });

        const details = data.videoDetails;

        if (!details) {
            throw new Error(
                data.playabilityStatus?.reason ||
                'Unable to retrieve video information'
            );
        }

        const microformat =
            data.microformat?.playerMicroformatRenderer || {};

        const streaming = data.streamingData || {};

        return {
            id,
            title: details.title,
            description: details.shortDescription,
            author: details.author,
            channelId: details.channelId,
            channelUrl: details.channelId
                ? `${BASE_URL}/channel/${details.channelId}`
                : null,
            duration: Number(details.lengthSeconds),
            durationFormatted: this.formatDuration(details.lengthSeconds),
            views: Number(details.viewCount),
            category: microformat.category || null,
            uploadDate: microformat.uploadDate || null,
            publishDate: microformat.publishDate || null,
            isLive: details.isLiveContent || false,
            isPrivate: details.isPrivate || false,
            isShort: details.isShortsEligible || false,
            isFamilySafe: details.isFamilySafe || false,
            keywords: details.keywords || [],
            thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url,
            thumbnails: this.getThumbnails(id),
            url: this.getVideoUrl(id),
            availableCountries: microformat.availableCountries || [],
            playabilityStatus: data.playabilityStatus?.status,
            formats: this.parseFormats(streaming),
            hasStreamingData: Boolean(
                streaming.formats?.length ||
                streaming.adaptiveFormats?.length
            )
        };
    },

    // ==============================
    // FORMAT PARSER
    // ==============================

    parseFormats(streaming = {}) {
        const formats = [
            ...(streaming.formats || []),
            ...(streaming.adaptiveFormats || [])
        ];

        return formats.map(format => {
            const mime = format.mimeType || '';
            const codecs = mime.match(/codecs="([^"]+)"/)?.[1];

            return {
                itag: format.itag,
                mimeType: mime.split(';')[0],
                codecs: codecs ? codecs.split(', ') : [],
                quality: format.qualityLabel || null,
                qualityLevel: format.quality || null,
                width: format.width || null,
                height: format.height || null,
                resolution: format.width && format.height
                    ? `${format.width}x${format.height}`
                    : null,
                fps: format.fps || null,
                bitrate: format.bitrate || null,
                averageBitrate: format.averageBitrate || null,
                audioBitrate: format.audioBitrate || null,
                audioQuality: format.audioQuality || null,
                sampleRate: format.audioSampleRate || null,
                channels: format.audioChannels || null,
                contentLength: format.contentLength || null,
                fileSize: format.contentLength
                    ? this.formatBytes(format.contentLength)
                    : 'Unknown',
                container: mime.split(';')[0].split('/')[1] || null,
                hasAudio: Boolean(format.audioQuality || format.audioChannels),
                hasVideo: Boolean(format.width || format.height),
                isAudio: mime.startsWith('audio/'),
                isVideo: mime.startsWith('video/'),
                hasDirectUrl: Boolean(format.url),
                requiresSignature: Boolean(format.signatureCipher || format.cipher),
                url: format.url || null
            };
        });
    },

    // ==============================
    // FORMAT FUNCTIONS
    // ==============================

    async getFormats(url) {
        const info = await this.getInfo(url);
        return info.formats;
    },

    async getAudioFormats(url) {
        const formats = await this.getFormats(url);
        return formats.filter(format => format.isAudio);
    },

    async getVideoFormats(url) {
        const formats = await this.getFormats(url);
        return formats.filter(format => format.isVideo);
    },

    async getCombinedFormats(url) {
        const formats = await this.getFormats(url);

        return formats.filter(
            format => format.hasAudio && format.hasVideo
        );
    },

    async getQuality(url) {
        const formats = await this.getVideoFormats(url);

        return [...new Set(
            formats.map(format => format.quality).filter(Boolean)
        )].sort((a, b) =>
            parseInt(b) - parseInt(a)
        );
    },

    async getAvailableItags(url) {
        const formats = await this.getFormats(url);
        return formats.map(format => format.itag);
    },

    async getBestAudio(url) {
        const formats = await this.getAudioFormats(url);

        return formats.sort(
            (a, b) => (b.bitrate || 0) - (a.bitrate || 0)
        )[0] || null;
    },

    async getBestVideo(url) {
        const formats = await this.getVideoFormats(url);

        return formats.sort(
            (a, b) =>
                (b.height || 0) - (a.height || 0) ||
                (b.bitrate || 0) - (a.bitrate || 0)
        )[0] || null;
    },

    async getFormatByItag(url, itag) {
        const formats = await this.getFormats(url);

        return formats.find(
            format => Number(format.itag) === Number(itag)
        ) || null;
    },

    async getFormatByQuality(url, quality) {
        const formats = await this.getVideoFormats(url);

        return formats.find(
            format => format.quality === quality
        ) || null;
    },

    // ==============================
    // THUMBNAIL FUNCTIONS
    // ==============================

    async getThumbnail(url, quality = 'hqdefault') {
        const id = this.getVideoId(url);

        if (!id) throw new Error('Invalid YouTube URL');

        return this.getThumbnailUrl(id, quality);
    },

    // ==============================
    // CHANNEL FUNCTIONS
    // ==============================

    async getChannel(url) {
        const info = await this.getInfo(url);

        return {
            id: info.channelId,
            name: info.author,
            url: info.channelUrl
        };
    },

    // ==============================
    // PLAYLIST FUNCTIONS
    // ==============================

    async getPlaylist(url) {
        const id = this.getPlaylistId(url);

        if (!id) throw new Error('Invalid playlist URL');

        const data = await this.innertube('browse', {
            browseId: 'VL' + id
        });

        return {
            id,
            url: `${BASE_URL}/playlist?list=${id}`,
            title: data.metadata?.playlistMetadataRenderer?.title || null,
            contents: data.contents || null
        };
    },

    // ==============================
    // RELATED VIDEO SEARCH
    // ==============================

    async getRelated(url) {
        const info = await this.getInfo(url);

        return this.search(info.title, {
            limit: 20
        });
    },

    // ==============================
    // VIDEO VALIDATION
    // ==============================

    async validate(url) {
        try {
            const info = await this.getInfo(url);

            return {
                valid: true,
                id: info.id,
                title: info.title,
                status: info.playabilityStatus
            };
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    },

    // ==============================
    // VIDEO METADATA HELPERS
    // ==============================

    async getTitle(url) {
        return (await this.getInfo(url)).title;
    },

    async getDescription(url) {
        return (await this.getInfo(url)).description;
    },

    async getViews(url) {
        return (await this.getInfo(url)).views;
    },

    async getAuthor(url) {
        return (await this.getInfo(url)).author;
    },

    async getVideoDuration(url) {
        return (await this.getInfo(url)).duration;
    },

    async getTags(url) {
        return (await this.getInfo(url)).keywords;
    },

    async getUploadDate(url) {
        return (await this.getInfo(url)).uploadDate;
    },

    async getCategory(url) {
        return (await this.getInfo(url)).category;
    },

    // ==============================
    // DOWNLOAD FORMAT SELECTION
    // ==============================

    async selectFormat(url, options = {}) {
        const formats = await this.getFormats(url);

        let selected = formats;

        if (options.type === 'audio') {
            selected = selected.filter(format => format.isAudio);
        }

        if (options.type === 'video') {
            selected = selected.filter(format => format.isVideo);
        }

        if (options.mimeType) {
            selected = selected.filter(format =>
                format.mimeType === options.mimeType
            );
        }

        if (options.quality) {
            selected = selected.filter(format =>
                format.quality === options.quality
            );
        }

        if (options.itag) {
            selected = selected.filter(format =>
                Number(format.itag) === Number(options.itag)
            );
        }

        if (options.minBitrate) {
            selected = selected.filter(format =>
                (format.bitrate || 0) >= options.minBitrate
            );
        }

        if (options.maxHeight) {
            selected = selected.filter(format =>
                !format.height || format.height <= options.maxHeight
            );
        }

        return selected;
    },

    // ==============================
    // SORTING FUNCTIONS
    // ==============================

    sortFormats(formats, sortBy = 'quality', order = 'desc') {
        const sorted = [...formats];

        const fields = {
            quality: 'height',
            bitrate: 'bitrate',
            filesize: 'contentLength',
            fps: 'fps'
        };

        const field = fields[sortBy];

        if (!field) return sorted;

        sorted.sort((a, b) => {
            const result = (a[field] || 0) - (b[field] || 0);
            return order === 'asc' ? result : -result;
        });

        return sorted;
    },

    // ==============================
    // SEARCH SUGGESTIONS
    // ==============================

    async suggestions(query) {
        const data = await this.request(
            'https://suggestqueries.google.com/complete/search',
            {
                params: {
                    client: 'firefox',
                    ds: 'yt',
                    q: query
                }
            }
        );

        return Array.isArray(data[1]) ? data[1] : [];
    },

    // ==============================
    // SHORTS DETECTION
    // ==============================

    isShorts(url) {
        try {
            const parsed = new URL(url);
            return parsed.pathname.startsWith('/shorts/');
        } catch {
            return false;
        }
    },

    // ==============================
    // EXPORT UTILITIES
    // ==============================

    async getDownloadMetadata(url, options = {}) {
        const info = await this.getInfo(url);

        let formats = info.formats;

        if (options.type === 'audio') {
            formats = formats.filter(format => format.isAudio);
        }

        if (options.type === 'video') {
            formats = formats.filter(format => format.isVideo);
        }

        return {
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            durationFormatted: info.durationFormatted,
            author: info.author,
            url: info.url,
            formats
        };
    }
};

module.exports = youtube;
