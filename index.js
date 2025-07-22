// Carica le variabili d'ambiente dal file .env
require('dotenv').config();

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

// Verifica la presenza del token GitHub
if (!process.env.GITHUB_TOKEN) {
    console.error('[GitHub] GITHUB_TOKEN non impostato. I sottotitoli potrebbero non funzionare correttamente.');
    console.error('[GitHub] Per configurare, crea un token su https://github.com/settings/tokens e impostalo come variabile d\'ambiente GITHUB_TOKEN');
}

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const path = require('path');
const fs = require('fs').promises;

// Funzione per verificare la cartella cache
async function checkCacheFolder() {
    const cacheFolder = path.join(process.cwd(), 'cache');
    try {
        // Verifica se la cartella cache esiste
        await fs.access(cacheFolder);
        console.log('[Cache] Cartella cache trovata:', cacheFolder);
        
        // Lista i file nella cartella cache
        const files = await fs.readdir(cacheFolder);
        const subtitleFiles = files.filter(f => f.endsWith('.srt') || f.endsWith('.txt1') || f.endsWith('.txt'));
        
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

        // Avvia il server usando serveHTTP di Stremio
        serveHTTP(addonInterface, options);
    } catch (error) {
        console.error('[Server] Errore durante l\'inizializzazione:', error);
        process.exit(1);
    }
}

// Avvia il server
initServer();
