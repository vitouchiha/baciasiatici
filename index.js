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
const app = express();
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');
const fs = require('fs').promises;

// Configura il server
const PORT = process.env.PORT || 3000;

// Abilita CORS per tutte le richieste
app.use(cors());

// Espone la cartella data
app.use('/data', express.static(path.join(__dirname, 'data')));

// Endpoint per i sottotitoli
app.get('/subtitle/:file', async (req, res) => {
    console.log(`[subtitles] Request for subtitle file: ${req.params.file}`);
    const filePath = path.join(__dirname, 'cache', req.params.file);
    
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitles] File not found: ${filePath}`);
            return res.status(404).send('Subtitle not found');
        }

        res.setHeader('Content-Type', 'application/x-subrip');
        const content = await fs.readFile(filePath, 'utf8');
        res.send(content);
        console.log(`[subtitles] Successfully served file: ${req.params.file}`);
    } catch (error) {
        console.error(`[subtitles] Error serving file ${filePath}:`, error);
        res.status(500).send('Error serving subtitle');
    }
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(addonInterface.manifest);
});

// Risorse catalog/meta/stream
app.get('/:resource/:type/:id.json', async (req, res) => {
    console.log(`[Endpoint] GET /${req.params.resource}/${req.params.type}/${req.params.id}.json`);
    const handler = addonInterface[req.params.resource];
    if (!handler) {
        console.error(`[Error] Handler not found for resource: ${req.params.resource}`);
        res.status(404).json({ error: 'not found' });
        return;
    }

    try {
        const response = await handler(req.params);
        res.setHeader('Content-Type', 'application/json');
        res.send(response);
    } catch (error) {
        console.error(`[Error] ${error.message}`);
        res.status(500).json({ error: 'internal error' });
    }
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Addon active on port ${PORT}`);
});
