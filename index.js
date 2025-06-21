// Abilita la garbage collection manuale se l'app viene avviata con --expose-gc
if (process.env.ENABLE_GARBAGE_COLLECTION === 'true') {
  try {
    global.gc = global.gc || require('vm').runInNewContext('gc');
    console.log('[Memory] Garbage collection manuale abilitata');
    
    // Esegui garbage collection periodicamente
    const gcInterval = parseInt(process.env.GC_INTERVAL || '300000', 10); // Default 5 minuti
    setInterval(() => {
      const before = process.memoryUsage().heapUsed / 1024 / 1024;
      global.gc();
      const after = process.memoryUsage().heapUsed / 1024 / 1024;
      console.log(`[Memory] Garbage collection eseguita: ${before.toFixed(2)} MB -> ${after.toFixed(2)} MB (liberati ${(before - after).toFixed(2)} MB)`);
    }, gcInterval);
  } catch (e) {
    console.warn('[Memory] Impossibile abilitare la garbage collection manuale:', e.message);
  }
}

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const path = require('path');
const fs = require('fs').promises;
const { decryptKisskhSubtitleFull, decryptKisskhSubtitleStatic } = require('./api/sub_decrypter');

// Funzione per servire i sottotitoli
async function serveSubtitle(req, res) {
    const match = req.url.match(/\/subtitle\/(.*?\.(?:srt|txt1))$/);
    if (!match) {
        console.log(`[subtitle] Not a subtitle request: ${req.url}`);
        return false; // Non è una richiesta di sottotitoli
    }

    const file = match[1];
    console.log(`[subtitle] Processing request for file: ${file}`);
    console.log(`[subtitle] Full URL: ${req.url}`);
    console.log(`[subtitle] Request headers:`, req.headers);
    
    const filePath = path.join(process.cwd(), 'cache', file);
    console.log(`[subtitle] Looking for file at: ${filePath}`);
    
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitle] File not found: ${filePath}`);
            res.writeHead(404);
            res.end('Subtitle not found');
            return true;
        }

        // Leggi il contenuto del file
        const content = await fs.readFile(filePath);
        let finalContent;

        // Se è un file .txt1, decripta il contenuto
        if (file.endsWith('.txt1')) {
            console.log('[subtitle] Processing .txt1 subtitle');
            try {
                const STATIC_KEY = Buffer.from('AmSmZVcH93UQUezi');
                const STATIC_IV = Buffer.from('ReBKWW8cqdjPEnF6');
                
                const contentStr = content.toString('utf8');
                if (contentStr.includes('static=true')) {
                    finalContent = decryptKisskhSubtitleStatic(content, STATIC_KEY, STATIC_IV);
                } else {
                    try {
                        finalContent = decryptKisskhSubtitleFull(content);
                    } catch (e) {
                        // Se la decrittazione fallisce, prova a usare il contenuto come testo normale
                        finalContent = contentStr;
                    }
                }
            } catch (error) {
                console.error('[subtitle] Decryption error:', error);
                res.writeHead(500);
                res.end('Error decrypting subtitle');
                return true;
            }
        } else {
            // Per i file .srt, usa il contenuto così com'è
            finalContent = content.toString('utf8');
        }

        if (!finalContent || finalContent.trim().length === 0) {
            console.error('[subtitle] Empty content after processing');
            res.writeHead(500);
            res.end('Invalid subtitle content');
            return true;
        }

        // Verifica che il contenuto sia un SRT valido
        if (!finalContent.match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
            console.error('[subtitle] Invalid SRT format');
            res.writeHead(500);
            res.end('Invalid subtitle format');
            return true;
        }
        
        // Imposta gli headers appropriati
        res.writeHead(200, {
            'Content-Type': 'application/x-subrip',
            'Content-Disposition': `inline; filename="${file.replace('.txt1', '.srt')}"`,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD',
            'Cache-Control': 'public, max-age=3600'
        });
        
        // Invia il contenuto
        res.end(finalContent);
        console.log(`[subtitle] Successfully served file: ${file}`);
        return true;
    } catch (error) {
        console.error(`[subtitle] Error serving file ${filePath}:`, error);
        res.writeHead(500);
        res.end('Error serving subtitle');
        return true;
    }
}

// Funzione per verificare la cartella cache
async function checkCacheFolder() {
    const cacheFolder = path.join(process.cwd(), 'cache');
    try {
        // Verifica se la cartella cache esiste
        await fs.access(cacheFolder);
        console.log('[Cache] Cartella cache trovata:', cacheFolder);
        
        // Lista i file nella cartella cache
        const files = await fs.readdir(cacheFolder);
        const subtitleFiles = files.filter(f => f.endsWith('.srt') || f.endsWith('.txt1'));
        
        if (subtitleFiles.length > 0) {
            console.log(`[Cache] Trovati ${subtitleFiles.length} file di sottotitoli in cache:`);
            for (const file of subtitleFiles) {
                const stats = await fs.stat(path.join(cacheFolder, file));
                console.log(`[Cache] - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
            }
        } else {
            console.log('[Cache] Nessun file di sottotitoli presente in cache');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[Cache] Cartella cache non trovata, verrà creata quando necessario');
            try {
                await fs.mkdir(cacheFolder, { recursive: true });
                console.log('[Cache] Cartella cache creata:', cacheFolder);
            } catch (mkdirError) {
                console.error('[Cache] Errore nella creazione della cartella cache:', mkdirError);
            }
        } else {
            console.error('[Cache] Errore nel controllo della cartella cache:', error);
        }
    }
}

// Creiamo un server usando serveHTTP di Stremio
const pathToLog = (url) => {
    const parts = url.split('?')[0].split('/');
    return parts.join('/');
};

const serverHandler = async (req, res) => {
    console.log(`[Server] ${new Date().toISOString()} - ${req.method} ${pathToLog(req.url)}`);
    
    // Prova prima a servire i sottotitoli
    const isSubtitle = await serveSubtitle(req, res);
    if (!isSubtitle) {
        // Se non è una richiesta di sottotitoli, passa il controllo a Stremio
        return false;
    }
    return true;
};

const options = {
    port: process.env.PORT || 3000,
    logger: {
        log: (msg) => console.log(`[Stremio] ${msg}`),
        error: (msg) => console.error(`[Stremio] ${msg}`)
    }
};

// Funzione di inizializzazione asincrona
async function initServer() {
    try {
        // Verifica la cartella cache prima di avviare il server
        await checkCacheFolder();

        // Avvia il server usando serveHTTP di Stremio e il nostro handler per i sottotitoli
        serveHTTP(addonInterface, { ...options, beforeMiddleware: serverHandler });
    } catch (error) {
        console.error('[Server] Errore durante l\'inizializzazione:', error);
        process.exit(1);
    }
}

// Avvia il server
initServer();
