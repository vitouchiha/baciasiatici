const { addonBuilder } = require('stremio-addon-sdk');
const kisskh = require('./kisskh');
const { getCloudflareCookie } = require('./cloudflare');
const { decryptKisskhSubtitleFull, decryptKisskhSubtitleStatic } = require('./sub_decrypter');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const cache = require('../middlewares/cache');
const path = require('path');
puppeteerExtra.use(StealthPlugin());

// Funzione helper per ottenere gli headers
async function getAxiosHeaders() {
    const cfCookie = await getCloudflareCookie();
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://kisskh.co/',
        'Origin': 'https://kisskh.co/',
        'Cookie': cfCookie
    };
}

// Funzione per verificare se un sottotitolo è in italiano
function isItalianSubtitle(subtitle, url) {
    const check = (str) => str && str.toLowerCase().includes('it');
    return check(subtitle.language) || 
           check(subtitle.label) || 
           check(subtitle.lang) ||
           (url && (url.toLowerCase().includes('.it.txt1') || 
                   url.toLowerCase().includes('.it.srt') || 
                   url.toLowerCase().includes('/it/') ||
                   url.toLowerCase().includes('italian')));
}

// Funzione per verificare se il contenuto è un SRT valido
function isValidSRT(content) {
    if (!content) return false;
    const text = typeof content === 'string' ? content : content.toString('utf8');
    return text.trim().match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/);
}

// Funzione per recuperare i sottotitoli usando Puppeteer
async function getSubtitlesWithPuppeteer(serieId, episodeId) {
    const cacheKey = `sub_${serieId}_${episodeId}`;
    
    // Controlla prima nella cache
    const cachedSubs = await cache.getAllSRTFiles(cacheKey);
    if (cachedSubs.length > 0) {
        console.log(`[subtitles] Found ${cachedSubs.length} cached Italian subtitles`);
        return cachedSubs;
    }

    console.log(`[subtitles] Fetching subtitles for serie ${serieId} episode ${episodeId}`);
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        
        let subApiUrl = null;
        page.on('request', request => {
            const url = request.url();
            if (!subApiUrl && url.includes('/api/Sub/')) {
                subApiUrl = url;
                console.log('[subtitles] Found subtitle API endpoint:', url);
            }
        });

        await page.goto(`https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${episodeId}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await new Promise(resolve => setTimeout(resolve, 4000));

        if (!subApiUrl) {
            console.warn('[subtitles] No subtitle endpoint intercepted');
            return [];
        }

        const headers = await getAxiosHeaders();
        const response = await axios.get(subApiUrl, { 
            responseType: 'arraybuffer', 
            headers,
            timeout: 10000
        });
        
        if (!response.data || !Buffer.isBuffer(response.data)) {
            console.error('[subtitles] Invalid API response');
            return [];
        }

        const buffer = Buffer.from(response.data);
        const asString = buffer.toString('utf8');
        
        let subtitleList;
        try {
            if (asString.startsWith('[')) {
                subtitleList = JSON.parse(asString);
            } else if (asString.startsWith('{')) {
                subtitleList = [JSON.parse(asString)];
            } else {
                console.warn('[subtitles] Response is not a subtitle list!');
                return [];
            }
        } catch (error) {
            console.error('[subtitles] Error parsing subtitle list:', error);
            return [];
        }

        console.log(`[subtitles] Found ${subtitleList.length} subtitle tracks from API`);
        const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
        const STATIC_IV = Buffer.from('ReBKWW8cqdjPEnF6');
        const decodedSubs = [];

        for (const sub of subtitleList) {
            let subtitleUrl = sub.src;
            if (!subtitleUrl && sub.GET && sub.GET.host && sub.GET.filename) {
                subtitleUrl = `${sub.GET.scheme || 'https'}://${sub.GET.host}${sub.GET.filename}`;
                if (sub.GET.query && sub.GET.query.v) {
                    subtitleUrl += `?v=${sub.GET.query.v}`;
                }
            }
            
            if (!subtitleUrl) {
                console.log('[subtitles] No URL found in subtitle data');
                continue;
            }

            // Verifica se il sottotitolo è in italiano
            if (!isItalianSubtitle(sub, subtitleUrl)) {
                console.log(`[subtitles] Skipping non-Italian subtitle: ${subtitleUrl}`);
                continue;
            }

            try {
                console.log(`[subtitles] Downloading Italian subtitle: ${subtitleUrl}`);
                const subResponse = await axios.get(subtitleUrl, { 
                    responseType: 'arraybuffer',
                    headers,
                    timeout: 10000
                });

                if (!subResponse.data || !Buffer.isBuffer(subResponse.data)) {
                    console.warn('[subtitles] Empty or invalid response from subtitle URL');
                    continue;
                }

                let content = Buffer.from(subResponse.data);
                const isTxt1 = subtitleUrl.toLowerCase().endsWith('.txt1');
                
                // Se è un .txt1, mantieni il contenuto criptato
                if (isTxt1) {
                    content = content.toString('utf8');
                } 
                // Altrimenti prova a decrittare o usare come plain text
                else {
                    try {
                        if (subtitleUrl.includes('static=true')) {
                            content = decryptKisskhSubtitleStatic(content, STATIC_KEY, STATIC_IV);
                        } else if (content[0] !== 0x31) { // not starting with "1"
                            content = decryptKisskhSubtitleFull(content);
                        } else {
                            content = content.toString('utf8');
                        }

                        // Verifica che sia un SRT valido
                        if (!isValidSRT(content)) {
                            console.warn('[subtitles] Invalid SRT format after decryption');
                            continue;
                        }
                    } catch (error) {
                        console.error('[subtitles] Decryption failed:', error);
                        continue;
                    }
                }

                if (!content || (typeof content === 'string' && content.trim().length === 0)) {
                    console.warn('[subtitles] Empty content after processing');
                    continue;
                }

                // Salva nella cache
                const savedPath = await cache.setSRT(cacheKey, content, 'it', isTxt1);
                if (savedPath) {
                    const fileName = path.basename(savedPath);
                    console.log(`[subtitles] Generated URL for subtitle: /subtitle/${fileName}`);
                    decodedSubs.push({
                        lang: 'it',
                        filePath: savedPath,
                        url: `/subtitle/${fileName}`,
                        isEncrypted: isTxt1
                    });
                } else {
                    console.warn('[subtitles] Failed to save subtitle to cache');
                }
            } catch (error) {
                console.error(`[subtitles] Error processing subtitle ${subtitleUrl}:`, error.message);
                continue;
            }
        }

        console.log(`[subtitles] Successfully processed ${decodedSubs.length} Italian subtitles`);
        return decodedSubs;

    } catch (error) {
        console.error('[subtitles] Error:', error);
        return [];
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
}

const builder = new addonBuilder({
    id: 'com.kisskh.addon',
    version: '1.2.5',
    name: 'KissKH Addon',
    description: 'Asian content',
    resources: [
        { name: 'catalog', types: ['series'] },
        { name: 'meta', types: ['series'], idPrefixes: ['kisskh_'] },
        { name: 'stream', types: ['series'], idPrefixes: ['kisskh_'], idPattern: 'kisskh_\\d+:\\d+' },
        { name: 'subtitles', types: ['series'], idPrefixes: ['kisskh_'] }
    ],
    types: ['series'],
    catalogs: [{
        type: 'series',
        id: 'kisskh',
        name: 'K-Drama',
        extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
            { name: 'limit', isRequired: false }
        ]
    }]
});

const seriesDetailsCache = new Map();
const streamCache = new Map();

async function getCachedSeriesDetails(seriesId) {
    if (seriesDetailsCache.has(seriesId)) {
        const cached = seriesDetailsCache.get(seriesId);
        if (Date.now() - cached.timestamp < 2 * 60 * 60 * 1000) {
            console.log(`[Cache] getSeriesDetails hit per ${seriesId}`);
            return cached.data;
        } else {
            seriesDetailsCache.delete(seriesId);
        }
    }
    const data = await kisskh.getSeriesDetails(seriesId);
    seriesDetailsCache.set(seriesId, { data, timestamp: Date.now() });
    return data;
}

async function extractStreamFromIframe(page) {
    try {
        const iframes = await page.$$('iframe');
        if (iframes.length === 0) return null;

        for (const iframe of iframes) {
            const src = await iframe.evaluate(el => el.src);
            if (src && (src.includes('player') || src.includes('embed'))) {
                console.log(`[extractStreamFromIframe] Found iframe with src: ${src}`);

                // Navigate to iframe source
                const iframePage = await page.browser().newPage();
                await iframePage.goto(src, { waitUntil: 'networkidle2', timeout: 30000 });

                // Look for stream URLs in iframe page
                const iframeContent = await iframePage.content();
                const streamMatches = iframeContent.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*|https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/g);

                if (streamMatches && streamMatches.length > 0) {
                    const streamUrl = streamMatches[0];
                    console.log(`[extractStreamFromIframe] Found stream in iframe: ${streamUrl}`);
                    await iframePage.close();
                    return streamUrl;
                }

                // Try to extract from network requests
                let iframeStreamUrl = null;
                iframePage.on('request', request => {
                    const url = request.url();
                    if (url.includes('.m3u8') || url.includes('.mp4')) {
                        console.log(`[extractStreamFromIframe] Intercepted stream in iframe: ${url}`);
                        iframeStreamUrl = url;
                    }
                });

                // Try clicking play button in iframe
                try {
                    const playButtons = [
                        '.jw-icon-playback', '.vjs-big-play-button',
                        '.play-button', '[aria-label="Play"]',
                        '.ytp-large-play-button', '.play-icon',
                        'button[title="Play"]', '.plyr__control--play'
                    ];

                    for (const selector of playButtons) {
                        const playButton = await iframePage.$(selector);
                        if (playButton) {
                            console.log(`[extractStreamFromIframe] Clicking play button in iframe: ${selector}`);
                            await playButton.click();
                            // Replace waitForTimeout with setTimeout wrapped in a Promise
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            break;
                        }
                    }
                } catch (e) {
                    console.log('[extractStreamFromIframe] Error clicking play in iframe:', e.message);
                }

                // Replace waitForTimeout with setTimeout wrapped in a Promise
                await new Promise(resolve => setTimeout(resolve, 5000));
                await iframePage.close();

                if (iframeStreamUrl) return iframeStreamUrl;
            }
        }
    } catch (e) {
        console.error('[extractStreamFromIframe] Error:', e.message);
    }
    return null;
}

async function resolveEpisodeStreamUrl(seriesId, episodeId) {
    const cacheKey = `${seriesId}_${episodeId}`;
    if (streamCache.has(cacheKey)) {
        const cached = streamCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 2 * 60 * 60 * 1000) {
            console.log(`[StreamCache] Hit per ${cacheKey}`);
            return cached.url;
        }
    }

    const browser = await puppeteerExtra.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    let streamUrl = null;

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

        // Enable request interception
        await page.setRequestInterception(true);

        // Set up request handler
        page.on('request', request => {
            // Block image and font requests to speed up loading
            if (['image', 'font', 'stylesheet'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        const cfCookieString = await getCloudflareCookie();
        const cfClearanceValue = cfCookieString.split('=')[1];
        await page.setCookie({
            name: 'cf_clearance',
            value: cfClearanceValue,
            domain: 'kisskh.co',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        });

        // Extract episode ID correctly
        let epId;
        if (episodeId.includes(':')) {
            epId = episodeId.split(':').pop();
        } else if (episodeId.startsWith('kisskh_')) {
            epId = episodeId.replace(/^kisskh_\d+:/, '');
        } else {
            epId = episodeId;
        }

        const targetUrl = `https://kisskh.co/Drama/Any/Episode-Any?id=${seriesId}&ep=${epId}`;
        console.log(`[resolveEpisodeStreamUrl] Navigating to ${targetUrl}`);

        // Track all network requests for stream URLs
        page.on('response', async response => {
            if (streamUrl) return; // Already found a stream

            const url = response.url();
            const contentType = response.headers()['content-type'] || '';

            // Direct stream URLs
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                console.log(`[resolveEpisodeStreamUrl] Direct stream found: ${url}`);
                streamUrl = url;
                return;
            }

            // API responses that might contain stream info
            if ((url.includes('/api/DramaList/') || url.includes('/api/Drama/')) &&
                contentType.includes('application/json')) {
                try {
                    const text = await response.text();
                    const data = JSON.parse(text);

                    // Check various possible fields for stream URLs
                    const possibleFields = ['Video', 'video', 'stream', 'url', 'src', 'source', 'file'];
                    for (const field of possibleFields) {
                        if (data && data[field] && typeof data[field] === 'string') {
                            const possibleUrl = data[field];
                            if (possibleUrl.includes('http') || possibleUrl.startsWith('//')) {
                                console.log(`[resolveEpisodeStreamUrl] Found stream in API (${field}): ${possibleUrl}`);
                                streamUrl = possibleUrl.startsWith('//') ? 'https:' + possibleUrl : possibleUrl;
                                return;
                            }
                        }
                    }

                    // Check for nested sources array
                    if (data && data.sources && Array.isArray(data.sources)) {
                        for (const source of data.sources) {
                            if (source && source.file && typeof source.file === 'string') {
                                console.log(`[resolveEpisodeStreamUrl] Found stream in sources array: ${source.file}`);
                                streamUrl = source.file.startsWith('//') ? 'https:' + source.file : source.file;
                                return;
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        });

        // Navigate to the page
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for content to load - replace waitForTimeout with setTimeout wrapped in a Promise
        await new Promise(resolve => setTimeout(resolve, 8000));

        // If no stream found yet, try direct API call
        if (!streamUrl) {
            try {
                // Try to make a direct API call to get the stream
                const apiUrl = `https://kisskh.co/api/DramaList/Episode/${epId}.png?err=false&ts=null&time=null`;
                console.log(`[resolveEpisodeStreamUrl] Trying direct API call: ${apiUrl}`);

                const apiResponse = await page.evaluate(async (url) => {
                    const response = await fetch(url);
                    return await response.text();
                }, apiUrl);

                try {
                    const apiData = JSON.parse(apiResponse);
                    if (apiData && apiData.Video) {
                        console.log(`[resolveEpisodeStreamUrl] Found stream in direct API call: ${apiData.Video}`);
                        streamUrl = apiData.Video;
                    }
                } catch (e) {
                    console.log('[resolveEpisodeStreamUrl] Error parsing API response:', e.message);
                }
            } catch (e) {
                console.log('[resolveEpisodeStreamUrl] Error with direct API call:', e.message);
            }
        }

        // If still no stream, try to click play button
        if (!streamUrl) {
            try {
                const playButtonSelectors = [
                    '.jw-icon-playback', '.vjs-big-play-button',
                    '.play-button', '[aria-label="Play"]',
                    '.ytp-large-play-button', '.play-icon',
                    'button[title="Play"]', '.plyr__control--play',
                    '.btn-play', '#play-button'
                ];

                for (const selector of playButtonSelectors) {
                    const playButton = await page.$(selector);
                    if (playButton) {
                        console.log(`[resolveEpisodeStreamUrl] Clicking play button: ${selector}`);
                        await playButton.click();
                        // Replace waitForTimeout with setTimeout wrapped in a Promise
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        break;
                    }
                }
            } catch (e) {
                console.log('[resolveEpisodeStreamUrl] Error clicking play button:', e.message);
            }
        }

        // If still no stream, try to extract from iframes
        if (!streamUrl) {
            streamUrl = await extractStreamFromIframe(page);
        }

        // If still no stream, try to extract from page content
        if (!streamUrl) {
            const pageContent = await page.content();

            // Look for m3u8 or mp4 URLs
            const streamMatches = pageContent.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*|https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/g);
            if (streamMatches && streamMatches.length > 0) {
                streamUrl = streamMatches[0];
                console.log(`[resolveEpisodeStreamUrl] Found stream in page content: ${streamUrl}`);
            } else {
                // Look for player configuration
                const jwPlayerMatch = pageContent.match(/jwplayer\([^)]+\)\.setup\((\{[^}]+\})\)/);
                if (jwPlayerMatch && jwPlayerMatch[1]) {
                    try {
                        // Extract and clean up the JSON string
                        let configStr = jwPlayerMatch[1].replace(/'/g, '"');
                        // Handle trailing commas which are invalid in JSON
                        configStr = configStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

                        // Try to parse as JSON
                        const config = JSON.parse(configStr);
                        if (config.file) {
                            streamUrl = config.file;
                            console.log(`[resolveEpisodeStreamUrl] Found stream in JW Player config: ${streamUrl}`);
                        } else if (config.sources && Array.isArray(config.sources) && config.sources.length > 0) {
                            streamUrl = config.sources[0].file;
                            console.log(`[resolveEpisodeStreamUrl] Found stream in JW Player sources: ${streamUrl}`);
                        }
                    } catch (e) {
                        console.log('[resolveEpisodeStreamUrl] Error parsing JW Player config:', e.message);
                    }
                }
            }
        }

        // Cache the result if found
        if (streamUrl) {
            streamCache.set(cacheKey, { url: streamUrl, timestamp: Date.now() });
        } else {
            console.warn(`[resolveEpisodeStreamUrl] No stream found for ${seriesId}:${epId}`);
        }

        return streamUrl;
    } catch (err) {
        console.error('[resolveEpisodeStreamUrl] Error:', err.stack || err.message);
        return null;
    } finally {
        await browser.close();
    }
}

builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
    console.log(`[CatalogHandler] Request catalog: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);

    if (type !== 'series') return { metas: [] };

    const limit = parseInt(extra.limit) || 30;
    const skip = parseInt(extra.skip) || 0;
    const page = Math.floor(skip / limit) + 1;
    const search = extra.search || '';
    const metas = await kisskh.getCatalog({ page, limit, search });
    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[MetaHandler] Request meta for id=${id}`);
    if (type !== 'series') return { meta: null };

    const seriesId = id.replace('kisskh_', '');
    let details;
    try {
        details = await getCachedSeriesDetails(seriesId);
        console.log('[MetaHandler] Details retrieved:', JSON.stringify(details, null, 2));
    } catch (e) {
        console.error('[MetaHandler] Error in getSeriesDetails:', e.stack || e.message);
        return {
            meta: {
                id,
                type: 'series',
                name: 'Loading Error',
                description: 'Unable to retrieve series details. Please try again later.',
                poster: '',
                videos: []
            }
        };
    }

    if (!details || !Array.isArray(details.episodes) || details.episodes.length === 0) {
        console.warn('[MetaHandler] Incomplete details or missing episodes for', seriesId);
        return {
            meta: {
                id,
                type: 'series',
                name: details?.title || 'Title not available',
                description: 'Series details incomplete or missing.',
                poster: details?.thumbnail || '',
                videos: []
            }
        };
    }

    // Map episodes correctly
    const videos = details.episodes.map(ep => ({
        id: `${ep.id}`,
        title: ep.title || `Episode ${ep.number}`,
        season: ep.season || 1,
        episode: ep.episode || ep.number || 1
    }));

    const meta = {
        id: `kisskh_${details.id}`,
        type: 'series',
        name: details.title || '',
        poster: details.thumbnail || '',
        background: details.thumbnail || '',
        posterShape: 'poster',
        description: (details.description || '').replace(/\r?\n+/g, ' ').trim(),
        releaseInfo: details.releaseDate ? details.releaseDate.slice(0, 4) : '',
        videos,
    };

    return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[StreamHandler] Request stream for id=${id}`);
    if (type !== 'series') return { streams: [] };

    if (!id.includes(':')) {
        console.log(`[StreamHandler] Generic request for ${id} (no episode selected)`);
        return {
            streams: [{
                title: '🔍 Select an episode to see the stream',
                url: 'https://stremio.com', // Dummy but valid URL
                isFree: true,
                behaviorHints: {
                    notWebReady: true,
                    catalogNotSelectable: true
                }
            }]
        };
    }

    // Robust ID parsing
    let seriesId, episodeId;
    if (id.startsWith('kisskh_')) {
        const parts = id.split(':');
        if (parts.length === 2) {
            // Normal case: "kisskh_123:456"
            seriesId = parts[0].replace('kisskh_', '');
            episodeId = parts[1];
        } else if (parts.length === 3) {
            // Anomalous case: "kisskh_123:kisskh_123:456"
            seriesId = parts[0].replace('kisskh_', '');
            episodeId = parts[2];
        } else {
            // Fallback
            seriesId = id.replace('kisskh_', '').split(':')[0];
            episodeId = id.split(':').pop();
        }
    } else {
        // Fallback for ID without prefix
        seriesId = id.split(':')[0];
        episodeId = id.split(':').pop();
    }
    console.log(`[StreamHandler] seriesId=${seriesId} episodeId=${episodeId}`);

    try {
        const streamUrl = await resolveEpisodeStreamUrl(seriesId, episodeId);

        if (!streamUrl) {
            return {
                streams: [{
                    title: '⏳ No stream found. Try again later.',
                    url: '',
                    isFree: true,
                    behaviorHints: { notWebReady: true }
                }]
            };
        }

        const format = streamUrl.includes('.m3u8') ? 'hls' : 'mp4';
        return {
            streams: [{
                title: '▶️ Episode Stream',
                url: streamUrl,
                isFree: true,
                format,
                behaviorHints: { notWebReady: false }
            }]
        };
    } catch (e) {
        console.error('[STREAM HANDLER ERROR]', e.stack || e.message);
        return {
            streams: [{
                title: '❌ Error during loading',
                url: '',
                isFree: true,
                behaviorHints: { notWebReady: true }
            }]
        };
    }
});

builder.defineSubtitlesHandler(async ({ type, id }) => {
    console.log(`[subtitles] Request for ${type} ${id}`);
    try {
        // Check cache first
        const cachedSubs = await cache.getAllSRTFiles(id);
        if (cachedSubs.length > 0) {
            console.log(`[subtitles] Cache hit for ${id}, found ${cachedSubs.length} subtitles`);
            return {
                subtitles: cachedSubs.map(sub => {
                    // Usa path assoluto per il sottotitolo
                    const subtitleUrl = `/subtitle/${path.basename(sub.filePath)}`;
                    console.log(`[subtitles] Serving subtitle at: ${subtitleUrl}`);
                    return {
                        id: `${id}_${sub.lang}`,
                        url: subtitleUrl,  // Il proxy Nginx gestirà correttamente questo path
                        lang: sub.lang
                    };
                })
            };
        }

        const [seriesId, episodeId] = id.replace('kisskh_', '').split(':');
        
        // Prima prova con il metodo diretto
        const headers = await getAxiosHeaders();
        const subUrl = `https://kisskh.co/api/DramaList/Episode/${episodeId}/Subtitle`;
        console.log(`[subtitles] Trying direct API at ${subUrl}`);
        
        let processedSubs = [];
        
        try {
            const { data: subtitleData } = await axios.get(subUrl, { headers });
            if (subtitleData && subtitleData.length > 0) {
                // Filtra solo i sottotitoli in italiano
                const italianSubs = subtitleData.filter(sub => 
                    isItalianSubtitle(sub, sub.src)
                );

                console.log(`[subtitles] Found ${italianSubs.length} Italian subtitles`);

                for (const sub of italianSubs) {
                    if (!sub.src) continue;
                    const { data: encryptedContent } = await axios.get(sub.src, { headers });
                    const decryptedContent = decryptKisskhSubtitleFull(encryptedContent);
                    if (decryptedContent) {
                        await cache.setSRT(id, decryptedContent, 'it');
                        const cacheKey = cache.getCacheKey(`${id}_it`);
                        const subtitleUrl = `/subtitle/${cacheKey}.srt`;
                        console.log(`[subtitles] Generated URL for subtitle: ${subtitleUrl}`);
                        processedSubs.push({
                            id: `${id}_it`,
                            url: subtitleUrl,
                            lang: 'it'
                        });
                    }
                }
            }
        } catch (error) {
            console.log(`[subtitles] Direct API failed, trying Puppeteer method: ${error.message}`);
        }

        // Se il metodo diretto fallisce, prova con Puppeteer
        if (processedSubs.length === 0) {
            console.log(`[subtitles] Trying Puppeteer method`);
            const puppeteerSubs = await getSubtitlesWithPuppeteer(seriesId, episodeId);
            
            for (const sub of puppeteerSubs) {
                await cache.setSRT(id, sub.text, 'it');
                const cacheKey = cache.getCacheKey(`${id}_it`);
                const subtitleUrl = `/subtitle/${cacheKey}.srt`;
                console.log(`[subtitles] Generated URL for subtitle: ${subtitleUrl}`);
                processedSubs.push({
                    id: `${id}_it`,
                    url: subtitleUrl,
                    lang: 'it'
                });
            }
        }

        console.log(`[subtitles] Successfully processed ${processedSubs.length} subtitles`);
        return { subtitles: processedSubs };
    } catch (error) {
        console.error(`[subtitles] Error: ${error.message}`);
        return { subtitles: [] };
    }
});

function vttToSrt(vttText) {
    // Se il testo inizia già con un numero, potrebbe essere già in formato SRT
    if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(vttText)) {
        // console.log('[vttToSrt] Il testo è già in formato SRT, lo restituisco così com'è');
        return vttText;
    }

    // Remove WEBVTT header
    let srt = vttText.replace(/^WEBVTT[\s\S]*?\n\n/, '');

    // Convert timestamps (00:00:00.000 --> 00:00:00.000)
    srt = srt.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');

    // Add sequential numbers for each subtitle block
    let counter = 1;
    srt = srt.replace(/\n\n/g, () => `\n${counter++}\n`);

    return srt;
}


module.exports = builder.getInterface();
