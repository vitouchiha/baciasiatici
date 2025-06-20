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

const express = require('express');
const cors = require('cors');
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');
const fs = require('fs').promises;

// Verifica e crea la cartella cache se non esiste
async function initializeCache() {
    const cacheDir = path.join(__dirname, 'cache');
    try {
        // Verifica se la directory esiste, altrimenti la crea
        await fs.access(cacheDir).catch(async () => {
            console.log('[Cache] Directory cache non trovata, la creo:', cacheDir);
            await fs.mkdir(cacheDir, { recursive: true });
        });

        console.log('[Cache] Directory cache esistente:', cacheDir);
        
        // Lista i file presenti e pulisci quelli scaduti
        const files = await fs.readdir(cacheDir);
        console.log(`[Cache] Trovati ${files.length} file nella cache:`);
        
        const now = Date.now();
        const ttl = 24 * 60 * 60 * 1000; // 24 ore
        let totalSize = 0;
        let expiredFiles = 0;

        for (const file of files) {
            const filePath = path.join(cacheDir, file);
            try {
                const stats = await fs.stat(filePath);
                const age = now - stats.mtime.getTime();
                
                if (age > ttl) {
                    await fs.unlink(filePath);
                    console.log(`[Cache] Rimosso file scaduto: ${file} (età: ${(age / 3600000).toFixed(2)} ore)`);
                    expiredFiles++;
                } else {
                    totalSize += stats.size;
                    const hours = age / 3600000;
                    console.log(`[Cache] - ${file} (${(stats.size / 1024).toFixed(2)} KB, età: ${hours.toFixed(2)} ore)`);
                }
            } catch (error) {
                console.error(`[Cache] Errore durante la verifica del file ${file}:`, error.message);
            }
        }

        console.log(`[Cache] Stato: ${(totalSize / 1024 / 1024).toFixed(2)} MB totali, ${expiredFiles} file scaduti rimossi`);
    } catch (error) {
        console.error('[Cache] Errore durante l\'inizializzazione della cache:', error);
    }
}

// Creiamo un router per i sottotitoli
const subtitleRouter = express.Router();

// Configuriamo il router dei sottotitoli
subtitleRouter.get('/:file', async (req, res) => {
    const startTime = Date.now();
    const fileName = req.params.file;
    console.log(`[subtitle] Richiesta sottotitolo: ${fileName} da ${req.ip}`);

    // Validazione nome file
    if (!fileName.match(/^[a-f0-9]+\.it\.srt$/i)) {
        console.warn(`[subtitle] Richiesta file non valido: ${fileName}`);
        return res.status(400).send('Invalid subtitle filename');
    }

    const filePath = path.join(__dirname, 'cache', fileName);
    const ttl = 24 * 60 * 60 * 1000; // 24 ore
    
    try {
        // Debug del percorso file
        console.log(`[subtitle] Cerco il file in: ${filePath}`);
        console.log(`[subtitle] La directory __dirname è: ${__dirname}`);
        
        // Verifica che la directory cache esista
        const cacheDir = path.join(__dirname, 'cache');
        try {
            await fs.access(cacheDir);
            console.log(`[subtitle] Directory cache esiste: ${cacheDir}`);
        } catch (error) {
            console.error(`[subtitle] Directory cache non trovata: ${cacheDir}`);
            return res.status(500).send('Cache directory not found');
        }

        // Lista tutti i file nella cache per debug
        const files = await fs.readdir(cacheDir);
        console.log(`[subtitle] File nella cache (${files.length} totali):`);
        for (const file of files) {
            const stats = await fs.stat(path.join(cacheDir, file));
            console.log(`[subtitle] - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        }

        // Verifica esistenza e validità del file
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitle] File non trovato: ${filePath}`);
            return res.status(404).send('Subtitle not found');
        }

        // Verifica età del file
        const stats = await fs.stat(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        
        if (fileAge > ttl) {
            console.log(`[subtitle] File scaduto, lo rimuovo: ${fileName} (età: ${(fileAge / 3600000).toFixed(2)} ore)`);
            await fs.unlink(filePath);
            return res.status(404).send('Subtitle expired');
        }

        // Leggi il file
        console.log(`[subtitle] Lettura del file: ${filePath}`);
        const content = await fs.readFile(filePath, 'utf8');
        console.log(`[subtitle] File letto, lunghezza: ${content.length} bytes`);
        
        // Verifica che il contenuto sia un SRT valido
        if (!content.trim().match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
            console.error(`[subtitle] File corrotto: ${fileName}`);
            await fs.unlink(filePath);
            return res.status(500).send('Invalid subtitle content');
        }

        // Imposta gli header appropriati
        res.setHeader('Content-Type', 'application/x-subrip');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache lato client 24 ore
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', content.length);
        
        // Invia il file
        res.send(content);

        const duration = Date.now() - startTime;
        console.log(`[subtitle] Servito file: ${fileName} (${(stats.size / 1024).toFixed(2)} KB in ${duration}ms)`);
    } catch (error) {
        console.error(`[subtitle] Errore durante il serving di ${fileName}:`, error);
        console.error(error.stack); // Log dello stack trace completo
        res.status(500).send('Error serving subtitle');
    }
});

// Configuriamo l'addon di Stremio con il router dei sottotitoli
const options = {
    port: process.env.PORT || 3000,
    getRouter: () => {
        const router = express.Router();
        
        // Aggiungiamo il supporto CORS per tutti gli endpoint
        router.use(cors({
            origin: '*',
            methods: ['GET', 'HEAD'],
            allowedHeaders: ['Content-Type', 'Accept', 'Range'],
            exposedHeaders: ['Content-Length', 'Content-Range']
        }));

        // Log di tutte le richieste
        router.use((req, res, next) => {
            console.log(`[Router] ${req.method} ${req.path} da ${req.ip}`);
            next();
        });
        
        // Montiamo il router dei sottotitoli PRIMA degli endpoint Stremio
        router.use('/subtitle', subtitleRouter);
        
        // Aggiungiamo gli endpoint standard dell'addon
        router.get('/manifest.json', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.send(addonInterface.manifest);
        });

        // Endpoint per verificare lo stato della cache dei sottotitoli
        router.get('/subtitle/status', async (req, res) => {
            try {
                const cacheDir = path.join(__dirname, 'cache');
                const files = await fs.readdir(cacheDir);
                const stats = [];
                
                for (const file of files) {
                    if (file.endsWith('.it.srt')) {
                        const filePath = path.join(cacheDir, file);
                        const fileStats = await fs.stat(filePath);
                        stats.push({
                            file,
                            size: fileStats.size,
                            age: (Date.now() - fileStats.mtime.getTime()) / 3600000
                        });
                    }
                }
                
                res.json({
                    total: stats.length,
                    files: stats
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        router.get('/:resource/:type/:id.json', async (req, res) => {
            const { resource, type, id } = req.params;
            const extra = req.query;

            console.log(`[Endpoint] GET /${resource}/${type}/${id}`);

            if (resource === 'stream' && type === 'series' && !id.includes(':')) {
                console.log(`[BLOCK] Stream generico bloccato per ${id}`);
                return res.json({
                    streams: [{
                        title: 'Seleziona un episodio',
                        url: 'https://stremio.com',
                        isFree: true,
                        behaviorHints: { notWebReady: true, catalogNotSelectable: true }
                    }]
                });
            }

            try {
                const out = await addonInterface.get({ resource, type, id, extra });
                res.setHeader('Content-Type', 'application/json');
                res.send(out);
            } catch (err) {
                console.error('[ERROR]', err.message);
                res.status(500).send({ error: err.message });
            }
        });

        // Gestione 404 per richieste non gestite
        router.use((req, res) => {
            console.log(`[404] Richiesta non gestita: ${req.method} ${req.path}`);
            res.status(404).send('Not Found');
        });

        // Aggiungiamo il middleware di gestione errori
        router.use(errorHandler);

        return router;
    }
};

// Inizializziamo la cache e poi avviamo il server
initializeCache().then(() => {
    // Avviamo il server con le nostre configurazioni personalizzate
    serveHTTP(addonInterface, options);
    console.log(`👉 Addon Stremio in ascolto su porta ${options.port}`);
}).catch(error => {
    console.error('[Cache] Errore durante l\'inizializzazione della cache:', error);
    process.exit(1);
});
