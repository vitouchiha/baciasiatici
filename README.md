# KissKH Stremio Addon - Configurazione

Questo README fornisce le istruzioni per configurare correttamente le variabili d'ambiente necessarie per eseguire l'addon KissKH in Docker, Portainer e altre piattaforme cloud.

## Variabili d'Ambiente

Le seguenti variabili d'ambiente devono essere configurate nel container Docker o nell'ambiente di hosting:

### Configurazione GitHub (Richiesta)

| Variabile | Descrizione |
|-----------|-------------|
| `GITHUB_TOKEN` | Token di GitHub per la creazione dei gist dei sottotitoli. [Come ottenere un token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) |

> **IMPORTANTE**: Il token GitHub è necessario per il corretto funzionamento dei sottotitoli. Assicurati di:
> 1. Creare un token con almeno lo scope `gist`
> 2. Configurare la variabile d'ambiente prima di avviare il container
> 3. Non condividere il token con altri

### Configurazione Puppeteer

| Variabile | Valore Predefinito | Descrizione |
|-----------|-------------------|-------------|
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | Evita il download di Chromium durante l'installazione di Puppeteer |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` | Percorso dell'eseguibile Chromium nel container |
| `PUPPETEER_ARGS` | `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-accelerated-2d-canvas --no-first-run --no-zygote --disable-gpu --hide-scrollbars --mute-audio` | Argomenti aggiuntivi per Chromium |

### Configurazione Node.js

| Variabile | Valore Predefinito | Descrizione |
|-----------|-------------------|-------------|
| `NODE_ENV` | `production` | Modalità di esecuzione di Node.js |
| `ENABLE_GARBAGE_COLLECTION` | `true` | Abilita la garbage collection manuale |
| `GC_INTERVAL` | `300000` | Intervallo per la garbage collection in ms (5 minuti) |

### Configurazione Cache

| Variabile | Valore Predefinito | Descrizione |
|-----------|-------------------|-------------|
| `CACHE_TTL` | `3600` | Tempo di cache in secondi (1 ora) |

### Configurazione Cloudflare

| Variabile | Valore Predefinito | Descrizione |
|-----------|-------------------|-------------|
| `CF_COOKIE_MAX_AGE` | `3600000` | Durata massima del cookie Cloudflare in ms (1 ora) |
| `CF_MAX_RETRY` | `3` | Numero massimo di tentativi per ottenere il cookie |
| `CF_RETRY_DELAY` | `5000` | Ritardo iniziale tra i tentativi in ms (5 secondi) |

## Configurazione in Portainer

Per configurare queste variabili in Portainer:

1. Vai alla sezione "Containers"
2. Seleziona "Add container" o modifica il container esistente
3. Scorri fino alla sezione "Environment"
4. Aggiungi la variabile `GITHUB_TOKEN` con il tuo token personale
5. Aggiungi tutte le altre variabili elencate sopra se vuoi personalizzare il comportamento
6. Imposta i limiti di risorse nella sezione "Resources":
   - Memory limit: `512M`
   - CPU limit: `0.5` (metà di un core)

## Guida Rapida GitHub Token

1. Vai su [GitHub Settings > Developer Settings > Personal Access Tokens > Tokens (classic)](https://github.com/settings/tokens)
2. Clicca su "Generate new token (classic)"
3. Dai un nome al token (es. "KissKH Addon")
4. Seleziona solo lo scope `gist`
5. Clicca "Generate token"
6. **IMPORTANTE**: Copia il token mostrato e salvalo in un posto sicuro
7. Configura la variabile d'ambiente `GITHUB_TOKEN` con il token appena creato

## Configurazione su Piattaforme Cloud

### Render

In Render, configura le variabili d'ambiente nelle impostazioni del servizio:

1. Vai al tuo servizio
2. Seleziona "Environment"
3. Aggiungi le variabili d'ambiente necessarie

### Vercel

In Vercel, configura le variabili d'ambiente nelle impostazioni del progetto:

1. Vai al tuo progetto
2. Seleziona "Settings" > "Environment Variables"
3. Aggiungi le variabili d'ambiente necessarie

### Hugging Face Spaces

In Hugging Face Spaces, configura le variabili d'ambiente nelle impostazioni dello Space:

1. Vai al tuo Space
2. Seleziona "Settings" > "Repository secrets"
3. Aggiungi le variabili d'ambiente necessarie

## Note Importanti

- **Memoria**: L'utilizzo di Puppeteer richiede una quantità significativa di memoria. Si consiglia di impostare un limite di memoria di almeno 512MB.
- **CPU**: Per prestazioni ottimali, assicurati di avere almeno 0.5 CPU core disponibili.
- **Storage**: Assicurati di avere almeno 500MB di spazio di archiviazione disponibile per Chromium e le dipendenze.
- **Rete**: L'addon richiede una connessione internet stabile per accedere a KissKH e bypassare Cloudflare.

## Risoluzione dei Problemi

Se riscontri problemi con il bypass di Cloudflare:

1. Verifica che Chromium sia installato correttamente nel container
2. Controlla che le variabili d'ambiente siano configurate correttamente
3. Aumenta il valore di `CF_MAX_RETRY` e `CF_RETRY_DELAY` per dare più tempo al bypass di Cloudflare
4. Controlla i log del container per eventuali errori

## Esempio di docker-compose.yml

```yaml
version: '3'

services:
  kisskh-addon:
    build: .
    container_name: kisskh-addon
    ports:
      - "3000:3000"
    environment:
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
      - NODE_ENV=production
      - CACHE_TTL=3600
      - ENABLE_GARBAGE_COLLECTION=true
      - GC_INTERVAL=300000
      - CF_COOKIE_MAX_AGE=3600000
      - CF_MAX_RETRY=3
      - CF_RETRY_DELAY=5000
    restart: unless-stopped
    mem_limit: 512m
    cpus: 0.5
```
Questo file README.md fornisce tutte le informazioni necessarie per configurare correttamente le variabili d'ambiente dell'addon KissKH in diversi ambienti di hosting.

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
