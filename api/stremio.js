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
    return (subtitle.language || '').toLowerCase() === 'it' || 
           (subtitle.label || '').toLowerCase() === 'italian' ||
           (url || '').toLowerCase().includes('.it.srt') ||
           (url || '').toLowerCase().includes('.it.txt1');
}

// Funzione per recuperare i sottotitoli usando Puppeteer
async function getSubtitlesWithPuppeteer(serieId, episodeId) {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    let subApiUrl = null;
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        
        // Intercetta le richieste per trovare l'URL dei sottotitoli
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
        const response = await axios.get(subApiUrl, { responseType: 'arraybuffer', headers });
        const buffer = Buffer.from(response.data);
        const asString = buffer.slice(0, 2000).toString('utf8').trim();
        
        let arr;
        if (asString.startsWith('[')) {
            arr = JSON.parse(asString);
        } else if (asString.startsWith('{')) {
            arr = [JSON.parse(asString)];
        } else {
            console.warn('[subtitles] Response is not a subtitle list!');
            return [];
        }

        console.log(`[subtitles] Found ${arr.length} subtitle tracks from API`);

        const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
        const STATIC_IV = Buffer.from('ReBKWW8cqdjPEnF6');
        const decodedSubs = [];

        for (const s of arr) {
            let subtitleUrl = s.src;
            if (!subtitleUrl && s.GET && s.GET.host && s.GET.filename) {
                subtitleUrl = `${s.GET.scheme || 'https'}://${s.GET.host}${s.GET.filename}`;
                if (s.GET.query && s.GET.query.v) {
                    subtitleUrl += `?v=${s.GET.query.v}`;
                }
            }
            
            if (!subtitleUrl) {
                console.log('[subtitles] No URL found in subtitle data');
                continue;
            }

            // Verifica se il sottotitolo è in italiano
            if (!isItalianSubtitle(s, subtitleUrl)) {
                console.log(`[subtitles] Skipping non-Italian subtitle: ${subtitleUrl}`);
                continue;
            }

            try {
                console.log(`[subtitles] Fetching from ${subtitleUrl}`);
                const subResponse = await axios.get(subtitleUrl, { responseType: 'arraybuffer' });
                const subBuffer = Buffer.from(subResponse.data);
                const subText = subBuffer.toString('utf8').trim();

                let text = null;
                // Prova prima come SRT/WEBVTT
                if (subText.startsWith('1') || subText.startsWith('WEBVTT')) {
                    text = decryptKisskhSubtitleFull(subText);
                } 
                // Se non è SRT/WEBVTT, prova come .txt1
                else if (subBuffer.length > 32) {
                    text = decryptKisskhSubtitleStatic(subBuffer, STATIC_KEY, STATIC_IV);
                }

                if (text) {
                    console.log('[subtitles] Successfully decrypted Italian subtitle');
                    decodedSubs.push({
                        text,
                        lang: 'it'
                    });
                }
            } catch (error) {
                console.error(`[subtitles] Error processing subtitle ${subtitleUrl}:`, error.message);
            }
        }

        return decodedSubs;
    } catch (error) {
        console.error('[subtitles] Error:', error.message);
        return [];
    } finally {
        await browser.close();
    }
}

// Configurazione del builder
const builder = new addonBuilder({
    id: 'com.kisskh.addon',
    version: '1.2.6',
    name: 'KissKH Addon',
    description: 'Asian content with Italian subtitles',
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['series'],
    catalogs: [{
        type: 'series',
        id: 'kisskh',
        name: 'KissKH Series',
        extra: [{
            name: 'search',
            isRequired: false
        }]
    }],
    idPrefixes: ['kisskh_']
});

// Handler del catalogo
builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
    console.log(`[CatalogHandler] Request catalog: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);

    if (type !== 'series') return { metas: [] };

    const limit = parseInt(extra.limit) || 30;
    const skip = parseInt(extra.skip) || 0;
    const page = Math.floor(skip / limit) + 1;
    const search = extra.search || '';

    try {
        console.log(`[CatalogHandler] Fetching page ${page} with limit ${limit}`);
        const metas = await kisskh.getCatalog({ page, limit, search });
        console.log(`[CatalogHandler] Found ${metas.length} items`);
        return { metas };
    } catch (error) {
        console.error('[CatalogHandler] Error:', error);
        return { metas: [] };
    }
});

// Handler per i meta
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`[MetaHandler] Request meta for id=${id}`);
    
    if (!id.startsWith('kisskh_')) return { meta: null };
    
    const serieId = id.split('_')[1];
    
    try {
        const details = await kisskh.getSeriesDetails(serieId);
        if (!details) return { meta: null };
        
        return {
            meta: {
                id: `kisskh_${details.id}`,
                type: 'series',
                name: details.title,
                poster: details.thumbnail,
                posterShape: 'poster',
                description: details.description,
                releaseInfo: details.releaseDate ? details.releaseDate.slice(0, 4) : '',
                videos: details.episodes.map(ep => ({
                    id: ep.id,
                    title: ep.title,
                    season: ep.season,
                    episode: ep.episode,
                    released: details.releaseDate
                }))
            }
        };
    } catch (error) {
        console.error('[MetaHandler] Error:', error);
        return { meta: null };
    }
});

// Handler per gli stream
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`[StreamHandler] Request stream for id=${id}`);
    
    if (!id.startsWith('kisskh_')) return { streams: [] };
    
    const [serieId, episodeId] = id.split(':');
    if (!serieId || !episodeId) return { streams: [] };
    
    const cleanSerieId = serieId.replace('kisskh_', '');
    
    try {
        console.log(`[StreamHandler] Getting stream for serie ${cleanSerieId} episode ${episodeId}`);
        const streamUrl = await kisskh.getEpisodeStream(cleanSerieId, episodeId);
        
        if (!streamUrl) {
            console.log('[StreamHandler] No stream URL found');
            return { streams: [] };
        }
        
        return {
            streams: [{
                url: streamUrl,
                title: 'Stream',
                behaviorHints: {
                    notWebReady: false,
                }
            }]
        };
    } catch (error) {
        console.error('[StreamHandler] Error:', error);
        return { streams: [] };
    }
});

// Handler per i sottotitoli
builder.defineSubtitlesHandler(async ({ type, id }) => {
    if (!id.startsWith('kisskh_')) return { subtitles: [] };
    
    const [serieId, episodeId] = id.split(':');
    if (!serieId || !episodeId) return { subtitles: [] };
    
    const cleanSerieId = serieId.replace('kisskh_', '');
    console.log(`[SubtitlesHandler] Fetching subtitles for serie ${cleanSerieId} episode ${episodeId}`);
    
    try {
        // First check if we have cached subtitles
        const processedSubs = [];
        const cacheKey = `${cleanSerieId}_${episodeId}`;
        const cachedSubs = await cache.getAllSRTFiles(cacheKey);
        
        if (cachedSubs && cachedSubs.length > 0) {
            console.log(`[subtitles] Found ${cachedSubs.length} cached subtitles`);
            for (const sub of cachedSubs) {
                const fileName = path.basename(sub.filePath);
                const subtitleUrl = `./subtitle/${fileName}`;
                processedSubs.push({
                    id: fileName,
                    url: subtitleUrl,
                    lang: 'it',
                    format: 'srt'
                });
            }
            return { subtitles: processedSubs };
        }

        // If no cached subs, fetch and process them
        console.log('[subtitles] No cached subtitles, fetching from source');
        const subs = await kisskh.getSubtitlesWithPuppeteer(cleanSerieId, episodeId);
        
        for (const sub of subs) {
            if (!sub.text) continue;
            
            const hash = crypto.createHash('md5').update(`${cleanSerieId}_${episodeId}_${sub.text}`).digest('hex');
            const fileName = `${hash}.it.srt`;
            
            const saved = await cache.setSRT(cacheKey, sub.text, 'it');
            if (saved) {
                const subtitleUrl = `./subtitle/${fileName}`;
                processedSubs.push({
                    id: fileName,
                    url: subtitleUrl,
                    lang: 'it',
                    format: 'srt'
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

// Esporta il builder compilato per l'interfaccia addon
module.exports = builder.getInterface();
