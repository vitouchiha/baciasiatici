const express = require('express');
const cors = require('cors');
const app = express();
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');

app.use(cors());

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(stremioInterface.manifest);
});

/*
// 🔧 Manifest JSON
app.get('/manifest.json', (req, res) => {
  console.log('[Endpoint] GET /manifest.json');
  res.setHeader('Content-Type', 'application/json');
  res.json(addonInterface.manifest);

});
*/
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
        const out = await stremioInterface.get({ resource, type, id, extra });
        res.setHeader('Content-Type', 'application/json');
        res.send(out);
    } catch (err) {
        console.error('[ERROR]', err.message);
        res.status(500).send({ error: err.message });
    }
});

  /*
  try {
    // Blocca le richieste stream generiche
    if (resource === 'stream' && type === 'series' && !id.includes(':')) {
      console.log(`[BLOCK] Ignorata richiesta stream generica per ${id}`);
      return res.json({ streams: [] });
    }

    if (!['catalog', 'meta', 'stream'].includes(resource)) {
      throw new Error(`Resource non supportata: ${resource}`);
    }

    const data = await addonInterface.get({ resource, type, id, extra });

    if (!data || typeof data !== 'object') {
      throw new Error('Risposta non valida dall\'addon');
    }

    console.log(`[Response] /${resource}/${type}/${id}.json OK`);
    res.json(data);
  } catch (err) {
    console.error('[ERROR]', JSON.stringify({
      error: err.message,
      stack: err.stack,
      params: req.params
    }, null, 2));
    res.status(500).send({ error: err.message });
  }
});
*/

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
