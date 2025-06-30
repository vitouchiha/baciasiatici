const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Aggiungi plugin stealth
puppeteerExtra.use(StealthPlugin());

// Configurazioni aggiuntive
const { executablePath } = require('puppeteer');
const cache = new Map();
const COOKIE_FILE_PATH = path.join(process.cwd(), 'data', 'cf_cookie.json');

// Configurazioni timeout e tentativi (con variabili d'ambiente)
const COOKIE_MAX_AGE = process.env.CF_COOKIE_MAX_AGE || 3600000; // 1 ora
const MAX_RETRY_ATTEMPTS = process.env.CF_MAX_RETRY || 3;
const RETRY_DELAY = process.env.CF_RETRY_DELAY || 5000; // 5s
const PROTOCOL_TIMEOUT = process.env.PUPPETEER_PROTOCOL_TIMEOUT || 60000; // 60s default

// Carica cookie da file
async function loadCookieFromFile() {
    try {
        const data = await fs.readFile(COOKIE_FILE_PATH, 'utf8');
        const cookieData = JSON.parse(data);
        if (cookieData.cf_clearance && cookieData.cf_clearance !== 'placeholder_value' && 
            cookieData.timestamp && (Date.now() - cookieData.timestamp < COOKIE_MAX_AGE)) {
            const cfCookieString = `cf_clearance=${cookieData.cf_clearance}`;
            cache.set('cf', cfCookieString);
            console.log('[Cloudflare] Cookie loaded from file:', cfCookieString);
            return true;
        } else if (cookieData.cf_clearance && cookieData.timestamp) {
            console.log('[Cloudflare] Cookie expired, will generate new one');
        }
    } catch (err) {
        console.log('[Cloudflare] No valid cookie file found, will generate new cookie');
    }
    return false;
}

// Salva cookie su file
async function saveCookieToFile(cookieValue) {
    try {
        await fs.mkdir(path.dirname(COOKIE_FILE_PATH), { recursive: true });
        await fs.writeFile(COOKIE_FILE_PATH, JSON.stringify({ 
            cf_clearance: cookieValue,
            timestamp: Date.now() 
        }));
        console.log('[Cloudflare] Cookie saved to file');
    } catch (err) {
        console.error('[Cloudflare] Error saving cookie to file:', err.message);
    }
}

async function getCloudflareCookie(forceRefresh = false) {
    console.log(`[Cloudflare] getCloudflareCookie called (forceRefresh=${forceRefresh})`);
    
    // Controlla cache
    if (cache.has('cf') && !forceRefresh) {
        console.log('[Cloudflare] Cookie found in cache');
        return cache.get('cf');
    }
    
    // Carica da file se non in cache
    if (!forceRefresh && await loadCookieFromFile()) {
        return cache.get('cf');
    }
    
    // Meccanismo di retry
    let retryCount = 0;
    let lastError = null;
    
    while (retryCount < MAX_RETRY_ATTEMPTS) {
        try {
            return await fetchCloudflareCookie();
        } catch (error) {
            lastError = error;
            retryCount++;
            console.log(`[Cloudflare] Attempt ${retryCount}/${MAX_RETRY_ATTEMPTS} failed: ${error.message}`);
            if (retryCount < MAX_RETRY_ATTEMPTS) {
                const delay = RETRY_DELAY * Math.pow(2, retryCount - 1);
                console.log(`[Cloudflare] Waiting ${delay}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.error('[Cloudflare] All attempts failed');
    throw lastError;
}

async function fetchCloudflareCookie() {
    // Configura timeout dinamico
    const timeoutValue = isNaN(Number(PROTOCOL_TIMEOUT)) 
        ? 60000 
        : Number(PROTOCOL_TIMEOUT);

    // Opzioni di lancio
    const launchOptions = {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--hide-scrollbars',
            '--mute-audio',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--window-size=1280,720',
            '--js-flags="--max-old-space-size=512"'
        ],
        ignoreHTTPSErrors: true,
        protocolTimeout: timeoutValue // Timeout dinamico qui
    };
    
    const browser = await puppeteerExtra.launch(launchOptions);
    try {
        const page = await browser.newPage();
        
        // Blocco risorse non necessarie
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1'
        });
        
        page.setDefaultNavigationTimeout(90000);
        
        console.log('[Cloudflare] Navigating to API endpoint...');
        await page.goto('https://kisskh.co/Explore?status=2&order=1&country=2&type=1', {  
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });
        
        console.log('[Cloudflare] Waiting for Cloudflare challenge to complete...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
        const cfDetected = await page.evaluate(() => {
            return document.querySelector('#cf-error-details') !== null || 
                   document.querySelector('.cf-error-code') !== null ||
                   document.querySelector('#challenge-running') !== null;
        });
        
        if (cfDetected) {
            console.log('[Cloudflare] Still on Cloudflare challenge page, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 20000));
        }
        
        const cookies = await page.cookies();
        console.log('[Cloudflare] Cookies received:', cookies.map(c => c.name).join(', '));
        
        const cfCookie = cookies.find(c => c.name === 'cf_clearance');
        
        if (!cfCookie) {
            await page.screenshot({ path: 'cloudflare-debug.png' });
            console.error('[Cloudflare] cf_clearance cookie not found. Current page content:');
            const pageContent = await page.content();
            console.error(pageContent.substring(0, 500) + '...');
            throw new Error('cf_clearance cookie not found');
        }
        
        const cfCookieString = `${cfCookie.name}=${cfCookie.value}`;
        cache.set('cf', cfCookieString);
        await saveCookieToFile(cfCookie.value);
        
        console.log('[Cloudflare] Cookie retrieved and cached:', cfCookieString);
        return cfCookieString;
    } catch (error) {
        console.error('[Cloudflare] Error retrieving cookie:', error.message);
        throw error;
    } finally {
        await browser.close();
        if (global.gc) global.gc();
    }
}

// Caricamento iniziale del cookie
loadCookieFromFile().catch(console.error);

module.exports = {
    getCloudflareCookie
};
