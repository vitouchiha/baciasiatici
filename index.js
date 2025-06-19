const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Assicurati sia nelle tue dipendenze
const LRU = require('lru-cache'); // Assicurati sia nelle tue dipendenze
const fs = require('fs').promises; // Per operazioni asincrone sui file
const fsSync = require('fs'); // Per operazioni sincrone (creazione cartella)
const path = require('path');
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
    "id": "org.kisskh.stremio-addon", // Mantieni il tuo ID
    "version": "1.2.5", // Da package.json
    "name": "KissKH Stremio Addon", // Da package.json
    "description": "KissKH Stremio Addon", // Da package.json
    "resources": ["catalog", "meta", "stream", "subtitles"],
    "types": ["movie", "series"], // Adatta ai tipi supportati dal tuo addon
    "idPrefixes": ["kkh_"], // Adatta se necessario
    // Aggiungi qui altre proprietà del manifest se presenti (logo, background, etc.)
};

const builder = new addonBuilder(manifest);

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
    // Esempio con un URL di test (sostituiscilo!)
    if (id === 'kkh_testmovie') { // Usa un ID di test
        return [
            { lang: 'Italian', url: 'https://cc.zorores.com/9d/0c/9d0c6c10a787386633730979a57a1d5b/ita-2.srt', id: 'it_test_1' },
            { lang: 'English', url: 'https://cc.zorores.com/9d/0c/9d0c6c10a787386633730979a57a1d5b/eng-3.srt', id: 'en_test_1' }
        ];
    }
    return [];
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

// Aggiungi qui altri gestori (catalog, meta, stream) se non sono già definiti
// builder.defineCatalogHandler(...)
// builder.defineMetaHandler(...)
// builder.defineStreamHandler(...)

const addonInterface = builder.getInterface();
app.use('/', serveHTTP(addonInterface));

// Avvio del server
const PORT = process.env.PORT || 7000; // Porta di default per sviluppo locale

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
