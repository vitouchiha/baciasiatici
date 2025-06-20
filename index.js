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

// Espone la cartella data
app.use('/data', express.static(path.join(__dirname, 'data')));

app.use(cors());

// Endpoint per servire i sottotitoli dalla cache
app.get('/subtitle/:file', async (req, res) => {
    console.log(`[subtitle] Request for file: ${req.params.file}`);
    const filePath = path.join(__dirname, 'cache', req.params.file);
    
    try {
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        if (!exists) {
            console.error(`[subtitle] File not found: ${filePath}`);
            return res.status(404).send('Subtitle not found');
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.setHeader('Content-Type', 'application/x-subrip');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(content);
        console.log(`[subtitle] Successfully served file: ${req.params.file}`);
    } catch (error) {
        console.error(`[subtitle] Error serving file ${filePath}:`, error);
        res.status(500).send('Error serving subtitle');
    }
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(addonInterface.manifest);
});

// 🔍 Risorse catalog/meta/stream
app.get('/:resource/:type/:id.json', async (req, res) => {
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

// 🈂️ Route sottotitoli
app.get('/subtitles/:seriesId/:episodeId/:lang.txt1', async (req, res) => {
  const { seriesId, episodeId, lang } = req.params;
  console.log(`[Endpoint] GET /subtitles/${seriesId}/${episodeId}/${lang}.srt`);
  try {
    if (!['en', 'it'].includes(lang.toLowerCase())) {
      return res.status(404).send('Subtitle not available');
    }

    const subs = await kisskh.getSubtitlesWithPuppeteer(seriesId, episodeId);
    const sub = subs.find(s => s.lang && s.lang.toLowerCase() === lang.toLowerCase() && s.text);
    if (!sub) {
      return res.status(404).send('Subtitle not found');
    }

    const srtText = sub.text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '\r\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(srtText);
  } catch (err) {
    console.error('[SUBTITLE ENDPOINT ERROR]', err);
    res.status(500).send('Error retrieving subtitle');
  }
});

// 🧱 Middleware errore
app.use(errorHandler);

// 🛰️ Avvio server
const PORT = process.env.PORT || 3000;
serveHTTP(addonInterface, { port: PORT });
console.log(`👉 Addon Stremio in ascolto su porta ${PORT}`);
