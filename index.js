const express = require('express');
const cors = require('cors');
const app = express();
const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./api/stremio');
const kisskh = require('./api/kisskh');
const errorHandler = require('./middlewares/errorHandler');

app.use(cors());

// 🔧 Manifest JSON
app.get('/manifest.json', (req, res) => {
  console.log('[Endpoint] GET /manifest.json');
  res.setHeader('Content-Type', 'application/json');
  res.json(addonInterface.manifest);

});

// 🔍 Risorse catalog/meta/stream
app.get('/:resource/:type/:id.json', async (req, res) => {
  const { resource, type, id } = req.params;
  const extra = req.query;

  console.log(`[Endpoint] GET /${resource}/${type}/${id}.json`);
  try {
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

// 🈂️ Route sottotitoli
app.get('/subtitles/:seriesId/:episodeId/:lang.srt', async (req, res) => {
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
