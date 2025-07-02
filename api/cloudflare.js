const chromium = require('chrome-aws-lambda');
const fs = require('fs').promises;
const path = require('path');

// Helper per ottenere le opzioni di Puppeteer
async function getPuppeteerOptions() {
    return {
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: true,
        ignoreHTTPSErrors: true
    };
};

const cache = new Map();
const COOKIE_FILE_PATH = path.join(process.cwd(), 'data', 'cf_cookie.json');
// Aggiungi configurazione per il tempo di validità del cookie e tentativi
const COOKIE_MAX_AGE = process.env.CF_COOKIE_MAX_AGE || 3600000; // 1 ora in ms
const MAX_RETRY_ATTEMPTS = process.env.CF_MAX_RETRY || 3;
const RETRY_DELAY = process.env.CF_RETRY_DELAY || 5000; // 5 secondi

// Try to load cookie from file on startup
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

// Save cookie to file for persistence
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
    console.log(`[Cloudflare] getCloudflareCookie chiamato (forceRefresh=${forceRefresh})`);
    
    // Check cache first
    if (cache.has('cf') && !forceRefresh) {
        console.log('[Cloudflare] Cookie trovato in cache');
        return cache.get('cf');
    }
    
    // Try to load from file if not in cache
    if (!forceRefresh && await loadCookieFromFile()) {
        return cache.get('cf');
    }
    
    // Implementa un meccanismo di retry con backoff esponenziale
    let retryCount = 0;
    let lastError = null;
    
    while (retryCount < MAX_RETRY_ATTEMPTS) {
        try {
            return await fetchCloudflareCookie();
        } catch (error) {
            lastError = error;
            retryCount++;
            console.log(`[Cloudflare] Tentativo ${retryCount}/${MAX_RETRY_ATTEMPTS} fallito: ${error.message}`);
            if (retryCount < MAX_RETRY_ATTEMPTS) {
                const delay = RETRY_DELAY * Math.pow(2, retryCount - 1);
                console.log(`[Cloudflare] Attendo ${delay}ms prima del prossimo tentativo...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.error('[Cloudflare] Tutti i tentativi falliti');
    throw lastError;
}

async function fetchCloudflareCookie() {
    const browser = await chromium.puppeteer.launch(await getPuppeteerOptions());
    try {
        const page = await browser.newPage();
        
        // Blocca risorse non necessarie per risparmiare memoria e banda
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Set a more realistic viewport
        await page.setViewport({ width: 1280, height: 720 });
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        
        // Set extra headers to appear more like a real browser
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Upgrade-Insecure-Requests': '1'
        });
        
        // Set default timeout
        page.setDefaultNavigationTimeout(90000);
        
        console.log('[Cloudflare] Navigating to API endpoint...');
        
        // Navigate to the site
        await page.goto('https://kisskh.co/Explore?status=2&order=1&country=2&type=1', {  
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });
        
        // Wait longer for Cloudflare challenge to complete
        console.log('[Cloudflare] Waiting for Cloudflare challenge to complete...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Try to detect if we're still on the Cloudflare page
        const cfDetected = await page.evaluate(() => {
            return document.querySelector('#cf-error-details') !== null || 
                   document.querySelector('.cf-error-code') !== null ||
                   document.querySelector('#challenge-running') !== null;
        });
        
        if (cfDetected) {
            console.log('[Cloudflare] Still on Cloudflare challenge page, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 15000));
        }
        
        // Get all cookies
        const cookies = await page.cookies();
        console.log('[Cloudflare] Cookies received:', cookies.map(c => c.name).join(', '));
        
        // Find the Cloudflare cookie
        const cfCookie = cookies.find(c => c.name === 'cf_clearance');
        
        if (!cfCookie) {
            // Take a screenshot for debugging
            await page.screenshot({ path: 'cloudflare-debug.png' });
            console.error('[Cloudflare] cf_clearance cookie not found. Current page content:');
            const pageContent = await page.content();
            console.error(pageContent.substring(0, 500) + '...');
            throw new Error('cf_clearance cookie non trovato');
        }
        
        const cfCookieString = `${cfCookie.name}=${cfCookie.value}`;
        
        // Save to cache and file
        cache.set('cf', cfCookieString);
        await saveCookieToFile(cfCookie.value);
        
        console.log('[Cloudflare] Cookie recuperato e salvato in cache:', cfCookieString);
        return cfCookieString;
    } catch (error) {
        console.error('[Cloudflare] Errore durante recupero cookie:', error.message);
        throw error;
    } finally {
        await browser.close();
        // Forza la garbage collection
        if (global.gc) {
            global.gc();
        }
    }
}

// Initialize by trying to load cookie from file
loadCookieFromFile().catch(console.error);

module.exports = {
    getCloudflareCookie
};
