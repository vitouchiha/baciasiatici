const { addonBuilder } = require('stremio-addon-sdk');
const kisskh = require('./kisskh');
const { getCloudflareCookie } = require('./cloudflare');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const builder = new addonBuilder({
    id: 'com.kisskh.addon',
    version: '1.1.8',
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
    console.log(`[SubtitlesHandler] Request subtitles for id=${id}`);
    if (type !== 'series') return { subtitles: [] };

    const [seriesId, episodeId] = id.replace('kisskh_', '').split(':');
    if (!seriesId || !episodeId) return { subtitles: [] };

    try {
        const subtitles = await kisskh.getSubtitlesWithPuppeteer(seriesId, episodeId);
        return {
            subtitles: subtitles.map(sub => ({
                id: `${id}:${sub.lang}`,
                lang: sub.lang,
                url: `data:text/vtt;base64,${Buffer.from(sub.text).toString('base64')}`
            }))
        };
    } catch (e) {
        console.error(`[SubtitlesHandler] Subtitle error:`, e.stack || e.message);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
