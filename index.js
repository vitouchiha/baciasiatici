// Importazioni
const express = require('express');
const cors = require('cors');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

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
        try {
            await fsPromises.access(cacheDir, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK);
            console.log('[Cache] Directory cache esiste con i permessi corretti:', cacheDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('[Cache] Directory cache non trovata, la creo:', cacheDir);
                await fsPromises.mkdir(cacheDir, { recursive: true, mode: 0o755 });
                // Verifica la creazione
                await fsPromises.access(cacheDir, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK);
            } else {
                throw new Error(`Problemi di permessi sulla directory cache: ${error.message}`);
            }
        }
        
        // Lista i file presenti e pulisci quelli scaduti
        const files = await fsPromises.readdir(cacheDir);
        console.log(`[Cache] Trovati ${files.length} file nella cache:`);
        
        const now = Date.now();
        const ttl = 24 * 60 * 60 * 1000; // 24 ore
        let totalSize = 0;
        let expiredFiles = 0;
        let validFiles = 0;

        for (const file of files) {
            const filePath = path.join(cacheDir, file);
            try {
                // Verifica i permessi del file
                await fsPromises.access(filePath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.W_OK);
                
                const stats = await fsPromises.stat(filePath);
                const age = now - stats.mtime.getTime();
                
                if (!file.match(/^[a-f0-9]+\.it\.srt$/i)) {
                    console.log(`[Cache] Rimuovo file non valido: ${file}`);
                    await fsPromises.unlink(filePath);
                    expiredFiles++;
                } else if (age > ttl) {
                    await fsPromises.unlink(filePath);
                    console.log(`[Cache] Rimosso file scaduto: ${file} (età: ${(age / 3600000).toFixed(2)} ore)`);
                    expiredFiles++;
                } else {
                    totalSize += stats.size;
                    validFiles++;
                    const hours = age / 3600000;
                    console.log(`[Cache] - ${file} (${(stats.size / 1024).toFixed(2)} KB, età: ${hours.toFixed(2)} ore)`);
                }
            } catch (error) {
                console.error(`[Cache] Errore durante la verifica del file ${file}:`, error.message);
                // Tenta di rimuovere i file problematici
                try {
                    await fsPromises.unlink(filePath);
                    console.log(`[Cache] Rimosso file problematico: ${file}`);
                    expiredFiles++;
                } catch (e) {
                    console.error(`[Cache] Impossibile rimuovere file problematico ${file}:`, e.message);
                }
            }
        }

        console.log(`[Cache] Stato: ${(totalSize / 1024 / 1024).toFixed(2)} MB totali, ${validFiles} file validi, ${expiredFiles} file rimossi`);
    } catch (error) {
        console.error('[Cache] Errore durante l\'inizializzazione della cache:', error);
        process.exit(1); // Exit if we can't set up the cache properly
    }
}

// Creiamo il router dei sottotitoli
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
        
        // Verifica che la directory cache esista
        const cacheDir = path.join(__dirname, 'cache');
        try {
            await fsPromises.access(cacheDir);
            console.log(`[subtitle] Directory cache esiste: ${cacheDir}`);
        } catch (error) {
            console.error(`[subtitle] Directory cache non trovata: ${cacheDir}`);
            return res.status(500).send('Cache directory not found');
        }

        // Lista tutti i file nella cache per debug
        const files = await fsPromises.readdir(cacheDir);
        console.log(`[subtitle] File nella cache (${files.length} totali):`);
        for (const file of files) {
            const stats = await fsPromises.stat(path.join(cacheDir, file));
            console.log(`[subtitle] - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        }

        // Verifica esistenza e validità del file
        let exists = true;
        try {
            await fsPromises.access(filePath);
        } catch {
            exists = false;
        }

        if (!exists) {
            console.error(`[subtitle] File non trovato: ${filePath}`);
            return res.status(404).send('Subtitle not found');
        }

        // Verifica età del file
        const stats = await fsPromises.stat(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        
        if (fileAge > ttl) {
            console.log(`[subtitle] File scaduto, lo rimuovo: ${fileName} (età: ${(fileAge / 3600000).toFixed(2)} ore)`);
            await fsPromises.unlink(filePath);
            return res.status(404).send('Subtitle expired');
        }

        // Leggi il file
        console.log(`[subtitle] Lettura del file: ${filePath}`);
        const content = await fsPromises.readFile(filePath, 'utf8');
        console.log(`[subtitle] File letto, lunghezza: ${content.length} bytes`);
        
        // Verifica che il contenuto sia un SRT valido
        if (!content.trim().match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
            console.error(`[subtitle] File corrotto: ${fileName}`);
            await fsPromises.unlink(filePath);
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
        console.error(error.stack);
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

        // Endpoint di stato
        app.get('/status', async (req, res) => {
            try {
                const cacheDir = path.join(__dirname, 'cache');
                let cacheExists = false;
                let cacheFiles = [];
                
                try {
                    await fsPromises.access(cacheDir);
                    cacheExists = true;
                    const files = await fsPromises.readdir(cacheDir);
                    for (const file of files) {
                        if (file.endsWith('.it.srt')) {
                            const stats = await fsPromises.stat(path.join(cacheDir, file));
                            cacheFiles.push({
                                name: file,
                                size: stats.size,
                                age: (Date.now() - stats.mtime.getTime()) / 3600000
                            });
                        }
                    }
                } catch (e) {
                    console.log('[Status] Cache directory check error:', e.message);
                }

                res.json({
                    status: 'running',
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    protocol: {
                        detected: req.protocol,
                        secure: isSecure(req),
                        headers: {
                            'x-forwarded-proto': req.get('x-forwarded-proto'),
                            'x-forwarded-host': req.get('x-forwarded-host'),
                            'host': req.get('host')
                        }
                    },
                    request: {
                        ip: req.ip,
                        path: req.path,
                        baseUrl: `${req.protocol}://${req.get('host')}`,
                        fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
                    },
                    cache: {
                        directory: cacheDir,
                        exists: cacheExists,
                        files: cacheFiles
                    }
                });
            } catch (error) {
                console.error('[Status] Error:', error);
                res.status(500).json({ 
                    error: error.message,
                    stack: error.stack
                });
            }
        });

        // Monta il router dei sottotitoli
        app.use('/subtitle', subtitleRouter);

        // Configura il router Stremio
        const stremioRouter = express.Router();
        
        // Usa il router per gli endpoint standard di Stremio
        stremioRouter.get('/manifest.json', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.send(addonInterface.manifest);
        });

        // Endpoint per il catalog
        stremioRouter.get('/catalog/:type/:id.json', async (req, res) => {
            const { type, id } = req.params;
            const extra = req.query;

            console.log(`[Stremio] Request: catalog/${type}/${id}`);
            console.log('[Stremio] Extra:', extra);

            try {
                const result = await addonInterface.catalog({ type, id, extra });
                res.setHeader('Content-Type', 'application/json');
                res.send(result);
            } catch (error) {
                console.error('[Stremio] Catalog Error:', error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Endpoint per meta, stream e subtitle
        stremioRouter.get('/:resource/:type/:id.json', async (req, res) => {
            const { resource, type, id } = req.params;
            const extra = req.query;

            console.log(`[Stremio] Request: ${resource}/${type}/${id}`);
            console.log('[Stremio] Extra:', extra);

            try {
                let result;
                
                switch (resource) {
                    case 'meta':
                        result = await addonInterface.meta({ type, id, extra });
                        break;
                    case 'stream':
                        if (type === 'series' && !id.includes(':')) {
                            result = {
                                streams: [{
                                    title: 'Seleziona un episodio',
                                    url: 'https://stremio.com',
                                    isFree: true,
                                    behaviorHints: { notWebReady: true, catalogNotSelectable: true }
                                }]
                            };
                        } else {
                            result = await addonInterface.stream({ type, id, extra });
                        }
                        break;
                    case 'subtitles':
                        result = await addonInterface.subtitles({ type, id, extra });
                        if (result && result.subtitles) {
                            result.subtitles = result.subtitles.map(sub => {
                                const fileName = sub.url && sub.url.startsWith('./subtitle/') ? 
                                    sub.url.substring('./subtitle/'.length) : 
                                    path.basename(sub.url);
                                return {
                                    ...sub,
                                    url: `${getSubtitleBaseUrl(req)}/${fileName}`
                                };
                            });
                        }
                        break;
                    default:
                        throw new Error(`Invalid resource type: ${resource}`);
                }

                res.setHeader('Content-Type', 'application/json');
                res.send(result);
            } catch (error) {
                console.error(`[Stremio] ${resource.charAt(0).toUpperCase() + resource.slice(1)} Error:`, error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Aggiungi il middleware di gestione errori al router Stremio
        stremioRouter.use(errorHandler);

        // Monta il router Stremio alla root
        app.use('/', stremioRouter);

        // Gestione 404 per richieste non gestite
        app.use((req, res) => {
            console.log(`[404] Richiesta non gestita: ${req.method} ${req.path}`);
            res.status(404).send('Not Found');
        });

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
