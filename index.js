// Importazioni
const express = require('express');
const cors = require('cors');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// Funzione per determinare se una richiesta è HTTPS
function isSecure(req) {
    return req.secure || 
           req.get('x-forwarded-proto') === 'https' || 
           req.get('x-arr-ssl') || 
           req.get('cloudfront-forwarded-proto') === 'https';
}

// Funzione per costruire l'URL base per i sottotitoli
function getSubtitleBaseUrl(req) {
    const proto = isSecure(req) ? 'https' : 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${proto}://${host}/subtitle`;
}

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

// Configurazione del server
async function startServer() {
    try {
        // Inizializza la cache
        await initializeCache();

        // Crea l'app Express
        const app = express();
        const port = process.env.PORT || 3000;

        // Configurazione base
        app.enable('trust proxy');
        app.use(cors({
            origin: '*',
            methods: ['GET', 'HEAD'],
            allowedHeaders: ['Content-Type', 'Accept', 'Range'],
            exposedHeaders: ['Content-Length', 'Content-Range']
        }));

        // Log middleware
        app.use((req, res, next) => {
            console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
            console.log(`[HTTP] Protocol: ${req.protocol}`);
            console.log(`[HTTP] Headers:`, JSON.stringify({
                'x-forwarded-proto': req.get('x-forwarded-proto'),
                'x-forwarded-host': req.get('x-forwarded-host'),
                'host': req.get('host')
            }, null, 2));
            next();
        });

        // Endpoint di test/stato
        app.get('/status', async (req, res) => {
            try {
                const cacheDir = path.join(__dirname, 'cache');
                let cacheStats = { files: [], totalSize: 0, fileCount: 0 };
                
                // Verifica l'esistenza e lo stato della cache
                try {
                    const exists = await fs.access(cacheDir).then(() => true).catch(() => false);
                    if (exists) {
                        const files = await fs.readdir(cacheDir);
                        for (const file of files) {
                            const filePath = path.join(cacheDir, file);
                            const stats = await fs.stat(filePath);
                            cacheStats.files.push({
                                name: file,
                                size: stats.size,
                                age: Date.now() - stats.mtime.getTime(),
                                mtime: stats.mtime
                            });
                            cacheStats.totalSize += stats.size;
                        }
                        cacheStats.fileCount = files.length;
                    }
                } catch (error) {
                    console.error('[status] Error getting cache stats:', error);
                    cacheStats.error = error.message;
                }

                res.json({
                    status: 'ok',
                    uptime: {
                        seconds: process.uptime(),
                        formatted: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m ${Math.floor(process.uptime() % 60)}s`
                    },
                    memory: process.memoryUsage(),
                    server: {
                        protocol: req.protocol,
                        baseUrl: `${req.protocol}://${req.get('host')}`,
                        headers: req.headers,
                        port: process.env.PORT || 3000,
                        env: process.env.NODE_ENV || 'development'
                    },
                    cache: {
                        directory: cacheDir,
                        exists: await fs.access(cacheDir).then(() => true).catch(() => false),
                        stats: {
                            fileCount: cacheStats.fileCount,
                            totalSizeBytes: cacheStats.totalSize,
                            totalSizeMB: (cacheStats.totalSize / (1024 * 1024)).toFixed(2),
                            files: cacheStats.files.map(f => ({
                                name: f.name,
                                sizeKB: (f.size / 1024).toFixed(2),
                                ageHours: (f.age / (1000 * 60 * 60)).toFixed(2),
                                lastModified: f.mtime
                            }))
                        }
                    }
                });
            } catch (error) {
                console.error('[status] Error in status endpoint:', error);
                res.status(500).json({
                    status: 'error',
                    error: error.message,
                    stack: error.stack
                });
            }
        });

        // Monta il router dei sottotitoli
        app.use('/subtitle', subtitleRouter);        // Configura il router Stremio
        const stremioRouter = express.Router();
        
        // Usa il router per gli endpoint standard di Stremio
        stremioRouter.get('/manifest.json', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.send(addonInterface.manifest);
        });

        stremioRouter.get('/:resource/:type/:id.json', async (req, res) => {
            const { resource, type, id } = req.params;
            const extra = req.query;

            console.log(`[Stremio] Request: ${resource}/${type}/${id}`);

            try {
                if (resource === 'stream' && type === 'series' && !id.includes(':')) {
                    return res.json({
                        streams: [{
                            title: 'Seleziona un episodio',
                            url: 'https://stremio.com',
                            isFree: true,
                            behaviorHints: { notWebReady: true, catalogNotSelectable: true }
                        }]
                    });
                }

                const result = await addonInterface.get({ resource, type, id, extra });
                
                // Se è una richiesta di sottotitoli, assicurati che gli URL siano corretti
                if (resource === 'subtitles' && result.subtitles) {
                    result.subtitles = result.subtitles.map(sub => ({
                        ...sub,
                        url: `${getSubtitleBaseUrl(req)}/${path.basename(sub.url)}`
                    }));
                }

                res.setHeader('Content-Type', 'application/json');
                res.send(result);
            } catch (error) {
                console.error('[Stremio] Error:', error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Aggiungi il middleware di gestione errori al router Stremio
        stremioRouter.use(errorHandler);

        // Monta il router Stremio
        app.use(stremioRouter);

        // Avvia il server
        app.listen(port, () => {
            console.log(`👉 Addon Stremio in ascolto su porta ${port}`);
            console.log(`📝 Test URLs:`);
            console.log(`   http://127.0.0.1:${port}/status`);
            console.log(`   http://127.0.0.1:${port}/manifest.json`);
        });

        // Abilita garbage collection se richiesto
        if (process.env.ENABLE_GARBAGE_COLLECTION === 'true') {
            try {
                global.gc = global.gc || require('vm').runInNewContext('gc');
                console.log('[Memory] Garbage collection manuale abilitata');
                
                const gcInterval = parseInt(process.env.GC_INTERVAL || '300000', 10);
                setInterval(() => {
                    const before = process.memoryUsage().heapUsed / 1024 / 1024;
                    global.gc();
                    const after = process.memoryUsage().heapUsed / 1024 / 1024;
                    console.log(`[Memory] GC: ${before.toFixed(2)} MB -> ${after.toFixed(2)} MB (liberati ${(before - after).toFixed(2)} MB)`);
                }, gcInterval);
            } catch (e) {
                console.warn('[Memory] Impossibile abilitare la garbage collection manuale:', e.message);
            }
        }

    } catch (error) {
        console.error('Errore durante l\'avvio del server:', error);
        process.exit(1);
    }
}

// Avvia il server
startServer();
