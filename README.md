# KissKH Stremio Addon v1.3.6

Addon Stremio per contenuti asiatici con sottotitoli italiani da KissKH.

## 🚀 Avvio Rapido

1. **Installa le dipendenze:**

   ```bash
   npm install
   ```

2. **Configura il token GitHub (opzionale per sottotitoli):**

   ```bash
   export GITHUB_TOKEN=your_github_token_here
   ```

3. **Avvia l'addon:**

   ```bash
   npm start
   ```

4. **Aggiungi a Stremio:**
   - URL: `http://localhost:3000/manifest.json`

## ✨ Funzionalità

- ✅ **Ricerca intelligente** con algoritmi di similarità avanzati
- ✅ **Sottotitoli automatici** in italiano (.srt, .txt, .txt1)
- ✅ **Ricerca dalla home** di Stremio tramite titolo
- ✅ **Cache ottimizzata** per performance migliori
- ✅ **Supporto ID esterni** (TMDB, IMDB)

## 🔧 Configurazione Avanzata

### Variabili d'Ambiente

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `PORT` | Porta server | `3000` |
| `GITHUB_TOKEN` | Token per gist sottotitoli | - |
| `ADDON_URL` | URL base addon | - |

### Docker

```bash
docker build -t kisskh-addon .
docker run -p 3000:3000 -e GITHUB_TOKEN=your_token kisskh-addon
```

## 🎬 Uso

1. Cerca contenuti direttamente dalla home di Stremio
2. I sottotitoli italiani sono caricati automaticamente
3. Supporta ricerca per titolo e ID esterni

## 📝 Note

- Versione: **1.3.6**
- Ricerca intelligente con stop automatico
- Performance ottimizzate per Stremio

---

*Addon sviluppato per contenuti asiatici con focus sui sottotitoli italiani*