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
builder.defineCatalogHandler(({ type, id, extra }) => {
    console.log(`[CatalogHandler] Request catalog: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);

    if (type !== 'series' || id !== 'kisskh') {
        console.log(`[CatalogHandler] Ignoring request for type=${type}, id=${id}`);
        return Promise.resolve({ metas: [] });
    }

    return kisskh.getCatalog({ 
        page: 1, 
        limit: 100,
        search: extra.search || '' 
    }).then(metas => {
        console.log(`[CatalogHandler] Found ${metas.length} items`);
        return { metas };
    }).catch(error => {
        console.error('[CatalogHandler] Error:', error);
        return { metas: [] };
    });
});

// Handler per i meta
builder.defineMetaHandler(({ type, id }) => {
    console.log(`[MetaHandler] Request meta for id=${id}`);
    
    if (type !== 'series' || !id.startsWith('kisskh_')) {
        return Promise.resolve({ meta: null });
    }

    const serieId = id.split('_')[1];
    return kisskh.getMeta(serieId)
        .then(meta => ({ meta }))
        .catch(error => {
            console.error('[MetaHandler] Error:', error);
            return { meta: null };
        });
});

// Handler per gli stream
builder.defineStreamHandler(({ type, id }) => {
    console.log(`[StreamHandler] Request stream for id=${id}`);
    
    if (type !== 'series' || !id.startsWith('kisskh_')) {
        return Promise.resolve({ streams: [] });
    }

    const [_, serieId, episodeId] = id.match(/kisskh_(\d+):(\d+)/) || [];
    if (!serieId || !episodeId) {
        return Promise.resolve({ streams: [] });
    }

    return kisskh.getStreams(serieId, episodeId)
        .then(streams => ({ streams }))
        .catch(error => {
            console.error('[StreamHandler] Error:', error);
            return { streams: [] };
        });
});

// Handler per i sottotitoli
builder.defineSubtitlesHandler(({ type, id }) => {
    console.log(`[SubtitlesHandler] Request subtitles for id=${id}`);
    
    if (type !== 'series' || !id.startsWith('kisskh_')) {
        return Promise.resolve({ subtitles: [] });
    }

    const [_, serieId, episodeId] = id.match(/kisskh_(\d+):(\d+)/) || [];
    if (!serieId || !episodeId) {
        return Promise.resolve({ subtitles: [] });
    }

    return kisskh.getSubtitlesWithPuppeteer(serieId, episodeId)
        .then(subtitles => ({ subtitles }))
        .catch(error => {
            console.error('[SubtitlesHandler] Error:', error);
            return { subtitles: [] };
        });
});

// Esporta il builder compilato per l'interfaccia addon
module.exports = builder.getInterface();
