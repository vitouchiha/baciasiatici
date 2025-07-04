const axios = require('axios');
const { getCloudflareCookie } = require('./cloudflare');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const { decryptKisskhSubtitleFull, decryptKisskhSubtitleStatic } = require('./sub_decrypter');


let vCache = new Map();

function extractEpisodeNumericId(episodeId) {
    if (typeof episodeId === 'number') return episodeId;
    if (episodeId && episodeId.includes(':')) {
        const parts = episodeId.split(':');
        return parts[1];
    }
    return episodeId;
}

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
    const searchTerm = search ? search.trim().toLowerCase() : '';
    
    // Se non c'è ricerca, ritorna il catalogo normale
    if (!searchTerm) {
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
    
    // Per la ricerca, raccogliamo risultati da più pagine fino a trovare abbastanza contenuti
    console.log(`[getCatalog] Searching for: "${searchTerm}"`);
    let allResults = [];
    let currentPage = 1;
    let consecutiveEmptyPages = 0;
    const maxPages = 10; // Limite massimo per evitare loop infiniti
    const maxEmptyPages = 3; // Fermiamoci se 3 pagine consecutive non danno risultati
    const targetResults = Math.max(limit, 3); // Ridotto da 5 a 3 per essere più efficiente
    
    while (allResults.length < targetResults && currentPage <= maxPages && consecutiveEmptyPages < maxEmptyPages) {
        const url = buildApiUrl({ page: currentPage, limit: 30, search });
        const headers = await getAxiosHeaders();
        console.log(`[getCatalog] Fetching page ${currentPage}: ${url}`);
        
        try {
            const { data } = await axios.get(url, { headers });
            if (!data || !data.data || data.data.length === 0) break;
            
            const pageResults = data.data.map(item => ({
                id: `kisskh_${item.id}`,
                type: 'series',
                name: item.title,
                poster: item.thumbnail,
                posterShape: 'poster',
                releaseInfo: item.releaseDate ? item.releaseDate.slice(0, 4) : ''
            }));
            
            // Filtriamo i risultati di questa pagina con algoritmo migliorato
            const filteredResults = pageResults.filter(item => {
                const itemTitle = item.name.toLowerCase();
                
                // 1. Corrispondenza esatta di termine
                if (itemTitle.includes(searchTerm)) {
                    return true;
                }
                
                // 2. Corrispondenza di parole singole
                const searchWords = searchTerm.split(' ').filter(w => w.length > 2);
                const titleWords = itemTitle.split(' ').filter(w => w.length > 2);
                
                for (const searchWord of searchWords) {
                    for (const titleWord of titleWords) {
                        if (titleWord.includes(searchWord) || searchWord.includes(titleWord)) {
                            return true;
                        }
                    }
                }
                
                // 3. Corrispondenza fuzzy per errori di battitura
                for (const titleWord of titleWords) {
                    if (titleWord.length >= 4 && searchTerm.length >= 4) {
                        const similarity = calculateSimilarity(searchTerm, titleWord);
                        if (similarity > 0.7) {
                            return true;
                        }
                    }
                }
                
                return false;
            });
            
            allResults = allResults.concat(filteredResults);
            
            // Aggiorna il contatore di pagine vuote
            if (filteredResults.length > 0) {
                consecutiveEmptyPages = 0; // Reset se troviamo risultati
            } else {
                consecutiveEmptyPages++;
            }
            
            // Se abbiamo trovato abbastanza risultati, possiamo fermarci
            if (allResults.length >= targetResults) {
                console.log(`[getCatalog] Found enough results (${allResults.length}), stopping search at page ${currentPage}`);
                break;
            }
            
            // Se abbiamo troppe pagine consecutive senza risultati, fermiamoci
            if (consecutiveEmptyPages >= maxEmptyPages) {
                console.log(`[getCatalog] ${maxEmptyPages} consecutive pages without results, stopping search at page ${currentPage}`);
                break;
            }
            
            currentPage++;
            
            // Continua a cercare anche se questa pagina non ha prodotto risultati filtrati
            // ma fermiamoci se non ci sono dati dall'API
            
        } catch (error) {
            console.error(`[getCatalog] Error fetching page ${currentPage}:`, error.message);
            break;
        }
    }
    
    console.log(`[getCatalog] Search completed after ${currentPage} pages. Total results found: ${allResults.length}`);
    
    // Limitiamo ai risultati richiesti e rimuoviamo duplicati
    const uniqueResults = allResults.filter((item, index, self) => 
        index === self.findIndex(t => t.id === item.id)
    );
    
    return uniqueResults.slice(0, limit);
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
            id: `kisskh_${data.id}:${ep.id}`,
            title: ep.title || `Episode ${ep.number}`,
            season: ep.season || 1,
            episode: ep.episode || ep.number || 1
        }))
    };
}

async function getVParam(serieId, episodeId) {
    const epId = extractEpisodeNumericId(episodeId);
    const cacheKey = `${serieId}_${epId}`;
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
        const targetUrl = `https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${epId}`;
        console.log(`[getVParam] navigating to ${targetUrl}`);
        page.on('request', request => {
            const url = request.url();
            // Intercetta SOLO url che iniziano con https:// e finiscono con .m3u8
            if (/^https:\/\/.*\.m3u8(\?.*)?$/.test(url)) {
                const match = url.match(/[?&]v=([a-zA-Z0-9]+)/);
                if (match) {
                    vParam = match[1];
                    console.log(`[getVParam] intercettato vParam: ${vParam} da url: ${url}`);
                }
            }
        });
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 4000));
        if (vParam) {
            vCache.set(cacheKey, { value: vParam, timestamp: Date.now() });
            console.log(`[getVParam] trovato: ${vParam}`);
            return vParam;
        } else {
            console.warn(`[getVParam] parametro v non trovato per ${serieId} ep ${epId}`);
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
    return episode.episode || episode.number;
}

async function getEpisodeStream(serieId, episodeId) {
    const epId = extractEpisodeNumericId(episodeId);
    const cacheKey = `${serieId}_${epId}_stream`;
    if (vCache.has(cacheKey)) {
        const cached = vCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 2 * 60 * 60 * 1000) {
            console.log(`[getEpisodeStream] cache hit per ${cacheKey}`);
            return cached.value;
        }
    }

    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
        const targetUrl = `https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${epId}`;
        console.log(`[getEpisodeStream] navigating to ${targetUrl}`);
        page.on('request', request => {
            const url = request.url();
            // Intercetta SOLO url che iniziano con https:// e finiscono con .m3u8 e hanno v param
            if (/^https:\/\/.*\.m3u8(\?.*)?$/.test(url) && /[?&]v=([a-zA-Z0-9]+)/.test(url)) {
                streamUrl = url;
                console.log(`[getEpisodeStream] intercettato stream: ${url}`);
            }
        });
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 8000));
        if (streamUrl) {
            vCache.set(cacheKey, { value: streamUrl, timestamp: Date.now() });
            return streamUrl;
        } else {
            console.warn(`[getEpisodeStream] Nessun stream intercettato per ${serieId}:${epId}`);
            return null;
        }
    } catch (err) {
        console.error('[getEpisodeStream] Errore:', err.stack || err.message);
        return null;
    } finally {
        await browser.close();
    }
}


async function getSubtitlesWithPuppeteer(serieId, episodeId) {
    const epId = extractEpisodeNumericId(episodeId);
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
        await page.goto(`https://kisskh.co/Drama/Any/Episode-Any?id=${serieId}&ep=${epId}`, {
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

        // Filtra solo i sottotitoli in italiano
        arr = arr.filter(s => {
            const lang = (s.land || s.label || '').toLowerCase();
            return lang === 'it' || lang === 'italian';
        });

        if (arr.length === 0) {
            console.warn('[WARN] Nessun sottotitolo italiano trovato');
            await browser.close();
            return [];
        }

        const decodedSubs = [];
        const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
        const STATIC_IV = Buffer.from('ReBKWW8cqdjPEnF6');

        for (const s of arr) {
            let subtitleUrl = s.src;
            if (!subtitleUrl && s.GET && s.GET.host && s.GET.filename) {
                subtitleUrl = `${s.GET.scheme || 'https'}://${s.GET.host}${s.GET.filename}`;
                if (s.GET.query && s.GET.query.v) {
                    subtitleUrl += `?v=${s.GET.query.v}`;
                }
            }
            if (!subtitleUrl) continue;

            // Facoltativo: mantieni il filtro sugli URL italiani per sicurezza
            const allowedPattern = /^https?:\/\/auto\.streamsub\.top\/.*\.it\.(srt|txt1|txt)$/i;
            if (!allowedPattern.test(subtitleUrl)) {
                console.log('[FILTER] Scartato endpoint non valido:', subtitleUrl);
                continue;
            } else {
                console.log('[FILTER] Endpoint accettato:', subtitleUrl);
            }

            try {
                const realResp = await axios.get(subtitleUrl, { responseType: 'arraybuffer' });
                const realBuf = Buffer.from(realResp.data);
                const realText = realBuf.toString('utf8').trim();

                let text = null;

                if (realText.startsWith('1') || realText.startsWith('WEBVTT')) {
                    text = decryptKisskhSubtitleFull(realText);
                } else if (realBuf.length > 32) {
                    text = decryptKisskhSubtitleStatic(realBuf, STATIC_KEY, STATIC_IV);
                }

                // Controlla se il file è criptato basandosi sull'estensione
                const isEncrypted = subtitleUrl.toLowerCase().endsWith('.txt1') || 
                                  subtitleUrl.toLowerCase().endsWith('.txt');
                
                if (isEncrypted && !text) {
                    console.warn('[WARN] File criptato ma decrittazione fallita:', subtitleUrl);
                    continue;
                }
                // Dopo aver decrittato il testo
                console.log('[DEBUG] Sottotitolo decrittato:', text.substring(0, 200)); // Mostra i primi 200 caratteri
                // Nella funzione getSubtitlesWithPuppeteer, modifica la parte dove aggiungi i sottotitoli decodificati:

                if (text) {
                    decodedSubs.push({
                        text,
                        lang: 'it' // Aggiungi il campo lang per i sottotitoli italiani
                    });
                }
            } catch (err) {
                console.warn('[WARN] Errore recupero sottotitolo:', err.message);
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


// Funzione per calcolare la similarità tra due stringhe (algoritmo Levenshtein semplificato)
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
    if (len2 === 0) return 0.0;
    
    // Matrice per il calcolo della distanza di Levenshtein
    const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    
    const maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
}


module.exports = {
    getCatalog,
    getSeriesDetails,
    getEpisodeStream,
    getVParam,
    getEpisodeNumber,
    getSubtitlesWithPuppeteer
};
