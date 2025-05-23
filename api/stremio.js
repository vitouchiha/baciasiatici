const { addonBuilder } = require('stremio-addon-sdk');
const kisskh = require('./kisskh');
const { getCloudflareCookie } = require('./cloudflare');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const fs = require('fs');
function findChromiumExecutable() {
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chrome'
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Chromium executable not found! Checked: ' + candidates.join(', '));
}

const builder = new addonBuilder({
    id: 'com.kisskh.vercel.addon',
    version: '1.0.5',
    name: 'KissKH Addon',
    description: 'Asian content',
    resources: [
        { name: 'catalog', types: ['series'] },
        { name: 'meta', types: ['series'], idPrefixes: ['kisskh_'] },
        { name: 'stream', types: ['series'], idPrefixes: ['kisskh_'], idPattern: /kisskh_\\d+:\\d+/ },
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
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: findChromiumExecutable()
});

    let streamUrl = null;

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

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

        const epId = episodeId.includes(':') ? episodeId.split(':')[1] : episodeId;
        const targetUrl = `https://kisskh.co/Drama/Any/Episode-Any?id=${seriesId}&ep=${epId}`;
        console.log(`[resolveEpisodeStreamUrl] navigating to ${targetUrl}`);

        page.on('request', request => {
            const url = request.url();
            if (url.includes('.m3u8')) { // || url.includes('.mp4')
                console.log(`[resolveEpisodeStreamUrl] intercettato stream: ${url}`);
                streamUrl = url;
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 10000));

        if (streamUrl) {
            streamCache.set(cacheKey, { url: streamUrl, timestamp: Date.now() });
        } else {
            console.warn(`[resolveEpisodeStreamUrl] Nessun stream intercettato per ${seriesId}:${episodeId}`);
        }

        return streamUrl;
    } catch (err) {
        console.error('[resolveEpisodeStreamUrl] Errore:', err.stack || err.message);
        return null;
    } finally {
        await browser.close();
    }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`[CatalogHandler] richiesta catalog: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);
    if (type !== 'series') return { metas: [] };
    const page = extra && extra.skip ? Math.floor(extra.skip / (extra.limit || 30)) + 1 : 1;
    const limit = extra && extra.limit ? extra.limit : 30;
    const search = extra && extra.search ? extra.search : '';
    const metas = await kisskh.getCatalog({ page, limit, search });
    return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[MetaHandler] richiesta meta per id=${id}`);
    if (type !== 'series') return { meta: null };

    const seriesId = id.replace('kisskh_', '');
    let details;
    try {
        details = await getCachedSeriesDetails(seriesId);
        console.log('[MetaHandler] Dettagli recuperati:', JSON.stringify(details, null, 2));
    } catch (e) {
        console.error('[MetaHandler] errore getSeriesDetails:', e.stack || e.message);
        return {
            meta: {
                id,
                type: 'series',
                name: 'Errore di caricamento',
                description: 'Impossibile recuperare i dettagli della serie. Riprova più tardi.',
                poster: '',
                videos: []
            }
        };
    }

    if (!details || !Array.isArray(details.episodes) || details.episodes.length === 0) {
        console.warn('[MetaHandler] dettagli incompleti o episodi mancanti per', seriesId);
        return {
            meta: {
                id,
                type: 'series',
                name: details?.title || 'Titolo non disponibile',
                description: 'Dettagli serie non completi o mancanti.',
                poster: details?.thumbnail || '',
                videos: []
            }
        };
    }

    // RIMAPPA CORRETTAMENTE GLI EPISODI
    const videos = details.episodes.map(ep => ({
        id: `kisskh_${details.id}:${ep.id}`,
        title: ep.title || `Episode ${ep.number}`,
        season: ep.season || 1,
        episode: ep.number
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
    console.log(`[StreamHandler] richiesta stream per id=${id}`);
    if (type !== 'series') return { streams: [] };
    if (!id.includes(':')) {
        console.log(`[StreamHandler] ignorata richiesta generica ${id}`);
        return {
            streams: [{
                title: 'Seleziona un episodio per vedere lo stream',
                url: '',
                isFree: true,
                behaviorHints: { notWebReady: true }
            }]
        };
    }

    // PATCH: Parsing robusto dell'ID
    let seriesId, episodeId;
    if (id.startsWith('kisskh_')) {
        const parts = id.split(':');
        if (parts.length === 2) {
            // Caso normale: "kisskh_123:456"
            seriesId = parts[0].replace('kisskh_', '');
            episodeId = `kisskh_${seriesId}:${parts[1]}`;
        } else if (parts.length === 3) {
            // Caso anomalo: "kisskh_123:kisskh_123:456"
            seriesId = parts[0].replace('kisskh_', '');
            episodeId = `kisskh_${seriesId}:${parts[2]}`;
        } else {
            // Fallback
            seriesId = id.replace('kisskh_', '').split(':')[0];
            episodeId = id;
        }
    } else {
        // Fallback per ID senza prefisso
        seriesId = id.split(':')[0];
        episodeId = id;
    }
    console.log(`[StreamHandler] seriesId=${seriesId} episodeId=${episodeId}`);

    try {
        // PATCH: RIMOSSO episodeNumber inutilizzato
        const streamUrl = await resolveEpisodeStreamUrl(seriesId, episodeId);

        if (!streamUrl) {
            return {
                streams: [{
                    title: '⏳ Nessuno stream trovato. Riprova più tardi.',
                    url: '',
                    isFree: true,
                    behaviorHints: { notWebReady: true }
                }]
            };
        }

        const format = streamUrl.includes('.m3u8') ? 'hls' : 'mp4';
        return {
            streams: [{
                title: '▶️ Stream episodio',
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
                title: '❌ Errore durante il caricamento',
                url: '',
                isFree: true,
                behaviorHints: { notWebReady: true }
            }]
        };
    }
});


builder.defineSubtitlesHandler(async ({ type, id }) => {
    console.log(`[SubtitlesHandler] richiesta subtitles per id=${id}`);
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
        console.error(`[SubtitlesHandler] Errore sottotitoli:`, e.stack || e.message);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
