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
const { serveHTTP, getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');
const fs = require('fs').promises;
const { decryptKisskhSubtitleFull, decryptKisskhSubtitleStatic } = require('./api/sub_decrypter');

// Estendi l'interfaccia dell'addon con l'endpoint dei sottotitoli
const subtitleHandler = async (req, res) => {
    const file = req.params.file;
    console.log(`[subtitle] Request for file: ${file}`);
    
    // Verifica che il file richiesto sia un sottotitolo
    if (!file.endsWith('.srt') && !file.endsWith('.txt1')) {
        console.error('[subtitle] Invalid file extension');
        return res.status(400).send('Invalid subtitle file');
    }

    const filePath = path.join(process.cwd(), 'cache', file);
    
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitle] File not found: ${filePath}`);
            return res.status(404).send('Subtitle not found');
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
                return res.status(500).send('Error decrypting subtitle');
            }
        } else {
            // Per i file .srt, usa il contenuto così com'è
            finalContent = content.toString('utf8');
        }

        if (!finalContent || finalContent.trim().length === 0) {
            console.error('[subtitle] Empty content after processing');
            return res.status(500).send('Invalid subtitle content');
        }

        // Verifica che il contenuto sia un SRT valido
        if (!finalContent.match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
            console.error('[subtitle] Invalid SRT format');
            return res.status(500).send('Invalid subtitle format');
        }
        
        // Imposta gli headers appropriati
        res.setHeader('Content-Type', 'application/x-subrip');
        res.setHeader('Content-Disposition', `inline; filename="${file.replace('.txt1', '.srt')}"`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache per 1 ora
        
        // Invia il contenuto
        res.send(finalContent);
        console.log(`[subtitle] Successfully served file: ${file}`);
    } catch (error) {
        console.error(`[subtitle] Error serving file ${filePath}:`, error);
        res.status(500).send('Error serving subtitle');
    }
};

// Crea l'app Express
const app = express();

// Middleware CORS
app.use(cors());

// Ottieni il router di base di Stremio
const router = getRouter(addonInterface);

// Aggiungi l'endpoint dei sottotitoli al router di Stremio
router.get('/subtitle/:file', subtitleHandler);

// Usa il router di Stremio per tutte le route
app.use(router);

// Log di tutte le richieste
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.originalUrl}`);
    next();
});

// Gestione degli errori
app.use(errorHandler);

// Avvia il server
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
    console.log(`[Server] Addon in ascolto sulla porta ${port}`);
    console.log('[Server] ===========================================');
});

// Gestione errori del server
server.on('error', (error) => {
    console.error('[Server] Errore:', error);
});

// Esporta l'interfaccia dell'addon per compatibilità
module.exports = addonInterface;

// Endpoint per servire i sottotitoli dalla cache
app.get('/subtitle/:file', async (req, res) => {
    const file = req.params.file;
    console.log(`[subtitle] Request for file: ${file}`);
    
    // Verifica che il file richiesto sia un sottotitolo
    if (!file.endsWith('.srt') && !file.endsWith('.txt1')) {
        console.error('[subtitle] Invalid file extension');
        return res.status(400).send('Invalid subtitle file');
    }

    const filePath = path.join(process.cwd(), 'cache', file);
    
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitle] File not found: ${filePath}`);
            return res.status(404).send('Subtitle not found');
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
                return res.status(500).send('Error decrypting subtitle');
            }
        } else {
            // Per i file .srt, usa il contenuto così com'è
            finalContent = content.toString('utf8');
        }

        if (!finalContent || finalContent.trim().length === 0) {
            console.error('[subtitle] Empty content after processing');
            return res.status(500).send('Invalid subtitle content');
        }

        // Verifica che il contenuto sia un SRT valido
        if (!finalContent.match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
            console.error('[subtitle] Invalid SRT format');
            return res.status(500).send('Invalid subtitle format');
        }
        
        // Imposta gli headers appropriati
        res.setHeader('Content-Type', 'application/x-subrip');
        res.setHeader('Content-Disposition', `inline; filename="${file.replace('.txt1', '.srt')}"`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache per 1 ora
        
        // Invia il contenuto
        res.send(finalContent);
        console.log(`[subtitle] Successfully served file: ${file}`);
    } catch (error) {
        console.error(`[subtitle] Error serving file ${filePath}:`, error);
        res.status(500).send('Error serving subtitle');
    }
});
