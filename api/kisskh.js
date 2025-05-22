const axios = require('axios');
const { getCloudflareCookie } = require('./cloudflare');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const { decryptKisskhSubtitleStatic } = require('./sub_decrypter');

let vCache = new Map();

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

function buildApiUrl({ page = 1, limit = 20, search = '' }) {
    let url = `https://kisskh.co/api/DramaList/List?page=${page}&type=1&sub=0&country=2&status=2&order=3&pageSize=${limit}`;
    if (search && search.trim().length > 0) {
        url += `&search=${encodeURIComponent(search)}`;
    }
    return url;
}

async function getCatalog({ page = 1, limit = 20, search = '' }) {
    const url = buildApiUrl({ page, limit, search });
    const headers = await getAxiosHeaders();
    console.log(`[getCatalog] URL: ${url}`);
    const { data } = await axios.get(url, { headers });
    if (!data || !data.data) return [];
    return data.data.map(item => ({
        id: `kisskh_${item.id}`,
        type: 'series',
        name: item.title,
        poster: item.thumbnail,
        posterShape: 'poster',
        releaseInfo: item.releaseDate ? item.releaseDate.slice(0, 4) : ''
    }));
}

async function getSeriesDetails(serieId) {
    const url = `https://kisskh.co/api/DramaList/Drama/${serieId}?isq=false`;
    const headers = await getAxiosHeaders();
    console.log(`[getSeriesDetails] URL: ${url}`);
    const { data } = await axios.get(url, { headers });
    if (!data) return null;
    return {
        id: data.id,
        title: data.title,
        thumbnail: data.thumbnail,
        description: data.description,
        releaseDate: data.releaseDate,
        episodes: (data.episodes || []).map(ep => ({
            // id in formato "kisskh_SERIEID:EPISODEID"
            id: `kisskh_${data.id}:${ep.id}`,
            title: ep.title || `Episode ${ep.number}`,
            season: ep.season || 1,
            episode: ep.number
        }))
    };
}

async function getVParam(serieId, episodeId) {
    const cacheKey = `${serieId}_${episodeId}`;
    const cached = vCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < 2 * 60 * 60 * 1000) {
        console.log(`[getVParam] cache hit per ${cacheKey}`);
        return cached.value;
    }

    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let vParam = null;

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
        const targetUrl = `https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${episodeId}`;
        console.log(`[getVParam] navigating to ${targetUrl}`);

        // Intercetta le richieste .m3u8 subito all'apertura
        page.on('request', request => {
            const url = request.url();
            const match = url.match(/Ep\d+_index\.m3u8\?v=([a-zA-Z0-9]+)/);
            if (match) {
                vParam = match[1];
                console.log(`[getVParam] intercettato vParam: ${vParam} da url: ${url}`);
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        if (vParam) {
            vCache.set(cacheKey, { value: vParam, timestamp: Date.now() });
            console.log(`[getVParam] trovato: ${vParam}`);
            return vParam;
        } else {
            console.warn(`[getVParam] parametro v non trovato per ${serieId} ep ${episodeId}`);
            return null;
        }
    } catch (error) {
        console.error('[getVParam] Errore:', error.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function getEpisodeNumber(serieId, episodeId) {
    console.log(`[getEpisodeNumber] Serie: ${serieId}, Episodio: ${episodeId}`);
    const details = await getSeriesDetails(serieId);
    if (!details || !details.episodes) throw new Error('Serie o episodi non trovati');
    const episode = details.episodes.find(ep => String(ep.id) === String(episodeId));
    if (!episode) throw new Error('Episodio non trovato');
    return episode.number;
}

async function getEpisodeStream(serieId, episodeId) {
    console.log(`[getEpisodeStream] serieId: ${serieId}, episodeId: ${episodeId}`);
    const details = await getSeriesDetails(serieId);
    if (!details || !details.episodes) {
        console.error('[getEpisodeStream] Nessun dettaglio serie trovato!');
        return null;
    }
    const episode = details.episodes.find(ep => String(ep.id) === String(episodeId));
    if (!episode) {
        console.error('[getEpisodeStream] Episodio non trovato!');
        return null;
    }
    const episodeNumber = episode.number;
    const vParam = await getVParam(serieId, episodeId);
    let streamUrl = `https://hls.streamsub.top/hls07/${serieId}/Ep${episodeNumber}_index.m3u8`;
    if (vParam) {
        streamUrl += `?v=${vParam}`;
    }
    console.log('[getEpisodeStream] streamUrl:', streamUrl);
    return streamUrl;
}

async function getSubtitlesWithPuppeteer(serieId, episodeId) {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    let subApiUrl = null;
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        page.on('request', request => {
            const url = request.url();
            if (!subApiUrl && url.includes('/api/Sub/')) {
                subApiUrl = url;
                console.log('[DEBUG] intercettato endpoint sottotitolo:', url);
            }
        });
        await page.goto(`https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${episodeId}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await new Promise(resolve => setTimeout(resolve, 4000));
        if (!subApiUrl) {
            console.warn('[WARN] Nessun endpoint sottotitolo intercettato');
            await browser.close();
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
            console.warn('[WARN] La risposta non è una lista di sottotitoli!');
            await browser.close();
            return [];
        }
        const decodedSubs = [];
        const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
        const STATIC_IV = Buffer.from('ReBKWW8cqdjPEnF6');
        for (const s of arr) {
            let lang = (s.land || s.label || 'unknown').toLowerCase();
            let subtitleUrl = s.src;
            if (!subtitleUrl && s.GET && s.GET.host && s.GET.filename) {
                subtitleUrl = `${s.GET.scheme || 'https'}://${s.GET.host}${s.GET.filename}`;
                if (s.GET.query && s.GET.query.v) {
                    subtitleUrl += `?v=${s.GET.query.v}`;
                }
            }
            if (!subtitleUrl) continue;
            try {
                const realResp = await axios.get(subtitleUrl, { responseType: 'arraybuffer' });
                const realBuf = Buffer.from(realResp.data);
                const realText = realBuf.toString('utf8').trim();
                let text = null;
                if (realText.startsWith('1') || realText.startsWith('WEBVTT')) {
                    text = realText;
                } else if (realBuf.length > 32) {
                    text = decryptKisskhSubtitleStatic(realBuf, STATIC_KEY, STATIC_IV);
                }
                if (text) {
                    decodedSubs.push({ lang, text });
                }
            } catch (err) {
                console.warn(`[WARN] [${lang}] Errore recupero sottotitolo:`, err.message);
            }
        }
        await browser.close();
        return decodedSubs;
    } catch (err) {
        console.error('[getSubtitlesWithPuppeteer] Errore:', err.message);
        await browser.close();
        return [];
    }
}

module.exports = {
    getCatalog,
    getSeriesDetails,
    getEpisodeStream,
    getVParam,
    getEpisodeNumber,
    getSubtitlesWithPuppeteer
};
