const { addonBuilder, serveHTTP, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Assicurati sia nelle tue dipendenze
const LRU = require('lru-cache'); // Assicurati sia nelle tue dipendenze
const fs = require('fs').promises; // Per operazioni asincrone sui file
const fsSync = require('fs'); // Per operazioni sincrone (creazione cartella)
const path = require('path');
const stremio = require('./api/stremio'); // Importa l'implementazione dei gestori
const kisskh = require('./api/kisskh');
const crypto = require('crypto'); // Per generare nomi file unici

const app = express();
app.use(cors());

// --- INIZIO LOGICA CACHING SOTTOTITOLI ---
const SRT_CACHE_DIR_NAME = 'srt_cache';
// Su Vercel, /tmp è scrivibile. Localmente, usa __dirname.
const SRT_CACHE_DIR = process.env.VERCEL ? path.join('/tmp', SRT_CACHE_DIR_NAME) : path.join(__dirname, SRT_CACHE_DIR_NAME);
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 ore in millisecondi
const CACHE_MAX_ITEMS = 200; // Numero massimo di file SRT da tenere in cache

// Assicura che la directory di cache esista (sincrono all'avvio)
try {
    if (!fsSync.existsSync(SRT_CACHE_DIR)) {
        fsSync.mkdirSync(SRT_CACHE_DIR, { recursive: true });
        console.log(`Directory cache SRT creata in ${SRT_CACHE_DIR}`);
    } else {
        console.log(`Directory cache SRT già esistente in ${SRT_CACHE_DIR}`);
    }
} catch (error) {
    console.error('Errore creazione directory cache SRT:', error);
    // Considera se questo è un errore fatale per la funzionalità dei sottotitoli
}

const subtitleCache = new LRU({
    max: CACHE_MAX_ITEMS,
    maxAge: CACHE_MAX_AGE,
    dispose: async (key, value) => { // 'key' è l'URL originale, 'value' è { localPath: '...' }
        if (value && value.localPath) {
            try {
                // Controlla se il file esiste prima di tentare di eliminarlo
                await fs.access(value.localPath);
                await fs.unlink(value.localPath);
                console.log(`Cache scaduta/rimossa e file eliminato: ${value.localPath}`);
            } catch (err) {
                // Se il file non esiste (ENOENT), va bene, potrebbe essere già stato eliminato
                if (err.code !== 'ENOENT') {
                    console.error(`Errore durante l'eliminazione del file ${value.localPath} dalla cache:`, err);
                }
            }
        }
    },
});

function generateLocalSrtFilename(originalUrl) {
    // Crea un hash MD5 dell'URL originale per un nome file unico e sicuro
    const hash = crypto.createHash('md5').update(originalUrl).digest('hex');
    return `${hash}.srt`;
}

// Nuova rotta Express per servire i file SRT dalla cache locale
app.get('/local-srt/:filename', async (req, res) => {
    const filename = req.params.filename;

    // Sanitizzazione di base del nome del file per prevenire directory traversal
    if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.srt')) {
        return res.status(400).send('Nome file non valido.');
    }

    const filePath = path.join(SRT_CACHE_DIR, filename);

    try {
        await fs.access(filePath); // Controlla se il file esiste
        res.setHeader('Content-Type', 'application/x-subrip'); // MIME type per SRT
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error(`Errore invio file ${filePath}:`, err);
                if (!res.headersSent) { // Invia errore solo se non sono già stati inviati header
                    res.status(err.status || 500).send('Errore invio file sottotitoli.');
                }
            }
        });
    } catch (error) {
        // File non trovato nella directory di cache
        console.warn(`File sottotitoli locale non trovato: ${filePath}`);
        res.status(404).send('File sottotitoli non trovato.');
    }
});
// --- FINE LOGICA CACHING SOTTOTITOLI ---

// Carica il tuo manifest attuale. Potrebbe essere definito qui o caricato da un file.
// Assicurati che i valori di 'name', 'version', 'description' corrispondano a package.json
const manifest = {
    id: "org.kisskh.stremio-addon", // ID dal tuo index.js originale
    version: "1.2.5",               // Da package.json
    name: "KissKH Stremio Addon",    // Da package.json
    description: "KissKH Stremio Addon", // Da package.json
    types: ["series"], // Coerente con le risorse e i cataloghi definiti (come in api/stremio.js)
    resources: [
        { name: 'catalog', types: ['series'] },
        { name: 'meta', types: ['series'], idPrefixes: ['kisskh_'] },
        { name: 'stream', types: ['series'], idPrefixes: ['kisskh_'], idPattern: 'kisskh_\\d+:\\d+' }, // idPattern da api/stremio.js
        { name: 'subtitles', types: ['series'], idPrefixes: ['kisskh_'] }
    ],
    catalogs: [{
        type: 'series',
        id: 'kisskh', // ID del catalogo, come in api/stremio.js
        name: 'K-Drama',      // Nome del catalogo
        extra: [ // 'extra' è importante per Stremio
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
            { name: 'limit', isRequired: false } // Come in api/stremio.js
        ]
    }],
    // Esempi di altre proprietà utili del manifest (opzionali):
    // "logo": "https://yourlogo.com/logo.png",
    // "background": "https://yourbackground.com/background.png",
    // "contactEmail": "your-email@example.com"
};

const builder = new addonBuilder(manifest);

// Integra i gestori dal file api/stremio.js
builder.defineCatalogHandler(stremio.defineCatalogHandler);
builder.defineMetaHandler(stremio.defineMetaHandler);
builder.defineStreamHandler(stremio.defineStreamHandler);

// *** IMPORTANTE: SOSTITUISCI QUESTA FUNZIONE CON LA TUA LOGICA REALE ***
// Questa è una funzione placeholder. Devi implementare la logica per ottenere
// i sottotitoli dalla tua fonte dati (KissKH).
async function getSubtitlesFromSource_actualLogic(type, id) {
    console.log(`(Placeholder) Richiesta sottotitoli per ${type} ${id} da KissKH.`);
    // Esempio di struttura dati che questa funzione dovrebbe restituire:
    // return [
    //   { lang: 'Italian', url: 'http://esempio.com/sub1_it.srt', id: 'sub1_it' },
    //   { lang: 'English', url: 'http://esempio.com/sub1_en.srt', id: 'sub1_en' },
    // ];
    // Se usi Puppeteer o altre logiche complesse, andranno qui.
    // Per ora, restituisce un array vuoto per evitare errori.
    
    if (type === 'series' && id.startsWith('kisskh_') && id.includes(':')) {
        try {
            const [seriesId, episodeId] = id.replace('kisskh_', '').split(':');
            const subtitles = await kisskh.getSubtitlesWithPuppeteer(seriesId, episodeId);

            return subtitles.map(sub => ({
                lang: 'Italian', // o gestisci dinamicamente se hai più lingue
                url: `data:text/srt;base64,${Buffer.from(sub.text).toString('base64')}`,
                id: `${id}:${sub.lang}` // Assicurati che l'ID sia unico
            }));
        } catch (e) {
            console.error('Errore in getSubtitlesFromSource_actualLogic:', e);
        }
    }
    return []; // Ritorna un array vuoto in caso di errore o tipo non supportato
}

builder.defineSubtitlesHandler(async ({ type, id, config }) => {
    console.log(`Richiesta sottotitoli per: type=${type}, id=${id}`);
    let finalSubtitles = [];

    try {
        const externalSubtitles = await getSubtitlesFromSource_actualLogic(type, id);

        if (!externalSubtitles || externalSubtitles.length === 0) {
            console.log('Nessun sottotitolo esterno trovato.');
            return Promise.resolve({ subtitles: [] });
        }

        for (const sub of externalSubtitles) {
            const isItalian = sub.lang && (sub.lang.toLowerCase() === 'italian' || sub.lang.toLowerCase() === 'ita' || sub.lang.toLowerCase() === 'it');
            const isSrt = sub.url && sub.url.toLowerCase().endsWith('.srt');

            if (isItalian && isSrt) {
                const originalSubUrl = sub.url;
                const localFilename = generateLocalSrtFilename(originalSubUrl);
                const localSrtPath = path.join(SRT_CACHE_DIR, localFilename);
                let newSub = { ...sub }; // Clona l'oggetto sottotitolo

                let servedFromCacheAndExists = false;
                if (subtitleCache.has(originalSubUrl)) {
                    const cachedEntry = subtitleCache.get(originalSubUrl); // Aggiorna LRU
                    try {
                        await fs.access(cachedEntry.localPath); // Controlla se il file esiste fisicamente
                        newSub.url = `/local-srt/${localFilename}`; // URL relativo servito dall'addon
                        servedFromCacheAndExists = true;
                        console.log(`Sottotitolo SRT italiano ${originalSubUrl} servito da cache: ${newSub.url}`);
                    } catch (e) {
                        subtitleCache.del(originalSubUrl); // File mancante, rimuovi dalla cache
                        console.warn(`File ${cachedEntry.localPath} per ${originalSubUrl} non trovato in cache. Sarà scaricato di nuovo.`);
                    }
                }

                if (!servedFromCacheAndExists) {
                    try {
                        console.log(`Download sottotitolo SRT italiano: ${originalSubUrl} a ${localSrtPath}`);
                        const response = await axios.get(originalSubUrl, {
                            responseType: 'arraybuffer', // Importante per dati binari / encoding corretto
                            timeout: 15000 // Timeout di 15 secondi
                        });
                        await fs.writeFile(localSrtPath, response.data);
                        subtitleCache.set(originalSubUrl, { localPath: localSrtPath });
                        newSub.url = `/local-srt/${localFilename}`; // URL relativo
                        console.log(`Sottotitolo SRT italiano ${originalSubUrl} scaricato e messo in cache. Servito come ${newSub.url}`);
                    } catch (downloadError) {
                        console.error(`Fallito download/cache per SRT italiano ${originalSubUrl}:`, downloadError.message);
                        // Se il download fallisce, manteniamo l'URL originale o potremmo decidere di non includerlo.
                        // Per ora, se il download fallisce, l'URL di `newSub` rimane quello originale.
                        // Potresti voler gestire diversamente questo caso (es. non aggiungere `newSub` a `finalSubtitles`).
                    }
                }
                finalSubtitles.push(newSub);
            } else {
                // Per sottotitoli non italiani o non SRT, li passiamo così come sono
                finalSubtitles.push(sub);
            }
        }
    } catch (error) {
        console.error('Errore nel gestore dei sottotitoli:', error);
        return Promise.reject(new Error(`Fallimento nel recuperare i sottotitoli: ${error.message}`));
    }

    // cacheMaxAge qui è per la cache del client Stremio della *lista* di sottotitoli
    return Promise.resolve({ subtitles: finalSubtitles, cacheMaxAge: 3600 }); // Cache lista per 1 ora
});

const addonInterface = builder.getInterface();
app.use('/', serveHTTP(addonInterface));


// Avvio del server
const PORT = process.env.PORT || 3000; // Porta di default per sviluppo locale

if (process.env.VERCEL) {
    // Se deployato su Vercel, Vercel gestisce l'avvio del server.
    // Esporta l'app per Vercel.
    module.exports = app;
} else {
    // Avvio server per ambiente locale/non-Vercel
    app.listen(PORT, () => {
        console.log(`Addon server in ascolto sulla porta ${PORT}`);
        console.log(`URL manifesto: http://127.0.0.1:${PORT}/manifest.json`);
        console.log(`Directory cache SRT: ${SRT_CACHE_DIR}`);
    });
}
