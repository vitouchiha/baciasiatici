const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const cache = new Map();

async function getCloudflareCookie(forceRefresh = false) {
    console.log(`[Cloudflare] getCloudflareCookie chiamato (forceRefresh=${forceRefresh})`);
    if (cache.has('cf') && !forceRefresh) {
        console.log('[Cloudflare] Cookie trovato in cache');
        return cache.get('cf');
    }
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        await page.goto('https://kisskh.co', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('body', { timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 10000));
        const cookies = await page.cookies();
        const cfCookie = cookies.find(c => c.name === 'cf_clearance');
        if (!cfCookie) throw new Error('cf_clearance cookie non trovato');
        const cfCookieString = `${cfCookie.name}=${cfCookie.value}`;
        cache.set('cf', cfCookieString);
        console.log('[Cloudflare] Cookie recuperato e salvato in cache:', cfCookieString);
        return cfCookieString;
    } catch (error) {
        console.error('[Cloudflare] Errore durante recupero cookie:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

module.exports = {
    getCloudflareCookie
};
