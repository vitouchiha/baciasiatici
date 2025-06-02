import cloudscraper from 'cloudscraper';
import * as cheerio from 'cheerio';

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
];

function getRandomHeaders() {
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Referer': 'https://ramaorientalfansub.tv/paese/corea-del-sud/',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

async function fetchWithCloudscraper(url, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[${i + 1}/${retries}] Tentativo di scraping: ${url}`);
            const response = await cloudscraper.get({
                uri: url,
                headers: getRandomHeaders(),
                followAllRedirects: true,
                maxRedirects: 2,
                timeout: 10000,
                resolveWithFullResponse: true
            });

            if (response.statusCode === 404) {
                console.warn(`⚠️ [404] Pagina non trovata: ${url}`);
                return null;
            }

            if (response.statusCode >= 200 && response.statusCode < 300) {
                console.log(`✅ [${i + 1}/${retries}] Successo: ${url}`);
                return response.body;
            } else {
                console.warn(`⚠️ [${i + 1}/${retries}] Errore HTTP ${response.statusCode} per ${url}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            const errorMessage = error.response ? `Errore ${error.response.statusCode}: ${error.message}` : error.message;
            console.warn(`⚠️ [${i + 1}/${retries}] ${errorMessage}`);

            if (error.message.includes('Cloudflare')) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    console.error(`❌ Impossibile recuperare ${url}`);
    return null;
}

const BASE_URL = 'https://ramaorientalfansub.tv/paese/corea-del-sud/';
const ITEMS_PER_PAGE = 25;
const MAX_PAGES = 35;
const catalogCache = new Map();

function cleanTitle(title) {
    const words = title.split(/\s+/);
    const uniqueWords = [];
    for (const word of words) {
        if (uniqueWords.indexOf(word) === -1) {
            uniqueWords.push(word);
        }
    }
    return uniqueWords.join(' ');
}

async function getCatalog(skip = 0, searchQuery = '') {
    const catalog = [];
    let pageNumber = Math.floor(skip / ITEMS_PER_PAGE) + 1;
    let itemsToLoad = ITEMS_PER_PAGE;

    while (catalog.length < itemsToLoad && pageNumber <= MAX_PAGES) {
        const pageUrl = `${BASE_URL}page/${pageNumber}/`;
        let data;

        if (catalogCache.has(pageUrl)) {
            data = catalogCache.get(pageUrl);
        } else {
            data = await fetchWithCloudscraper(pageUrl);
            if (!data) {
                pageNumber++;
                continue;
            }
            catalogCache.set(pageUrl, data);
        }

        const $ = cheerio.load(data);

        $('div.bg-gradient-to-t').each((index, element) => {
            if (catalog.length >= itemsToLoad) return false;

            const posterElement = $(element).find('.block.relative.w-full.group.kira-anime.add-rem.overflow-hidden > img');
            let poster = posterElement.attr('src');
            // Verifica che l'URL del poster inizi con 'https://www.themoviedb.org'
            if (poster && (poster.startsWith('https://www.themoviedb.org') || poster.startsWith('https://ramaorientalfansub.tv/wp-content/uploads'))) {
               // console.log(`Poster trovato: ${poster}`);
            } else {
               // console.warn(`Poster non valido o non inizia con 'https://www.themoviedb.org': ${poster}`);
                poster = null; // Imposta poster a null se non valido
            }

            const titleElement = $(element).find('a.text-sm.line-clamp-2.font-medium.leading-snug.lg\\:leading-normal');
            let title = titleElement.text().trim();
            title = cleanTitle(title);

            const link = titleElement.attr('href');
            if (!link) {
                console.warn(`Link mancante per l'elemento ${index}`);
                return true;
            }

            const tagElement = $(element).find('div.text-xs.text-text-color.w-full.line-clamp-1.absolute.bottom-1.text-opacity-75 span.inline-block.md\\:mlb-3.uppercase');
            const tagText = tagElement.text().trim().toLowerCase();

            const excludeElement = $(element).find('div.bg-gradient-to-t > div > div:nth-child(3) > span:nth-child(2)');
            const excludeText = excludeElement.text().trim();
            const includeTv = tagText.includes('tv');
            const excludeE = excludeText.includes('E ?');

            if (searchQuery && !title.toLowerCase().includes(searchQuery.toLowerCase())) {
                return true;
            }

            if (excludeE) {
                return true;
            }

            if (!includeTv) {
                return true;
            }

            const formattedTitle = title.replace(/\s+/g, '-').toLowerCase().replace(/[()]/g, '');
            const meta = {
                id: formattedTitle,
                type: 'series',
                name: title,
                poster: poster || 'https://example.com/default-poster.jpg',
            };
            catalog.push(meta);
        });

        pageNumber++;
    }

    return catalog;
}

export default async function (args) {
    const skip = args.extra?.skip || 0;
    const searchQuery = args.extra?.search || '';
    const metas = await getCatalog(skip, searchQuery);
    return { metas };
};
