> 1. Creare un token con almeno lo scope `gist`
> 2. Configurare la variabile d'ambiente prima di avviare il container
> 3. Non condividere il token con altri

# KissKH Stremio Addon (v2.0.1)

Addon Stremio per accedere al catalogo KissKH e ai sottotitoli auto-generati.

## Requisiti
- Node.js 18+
- Docker e Docker Compose (per deploy containerizzato)
- Un token GitHub personale con permesso `gist` (per salvare i sottotitoli)
- **IP italiano** (VPN/proxy consigliato) per ottenere i sottotitoli auto-generati da KissKH

## Attenzione sui sottotitoli
> **Per ottenere i sottotitoli auto-generati da KissKH è necessario che l'IP del container/addon sia italiano.**
> Puoi usare una VPN, un proxy residenziale italiano o un server in Italia. Se usi Portainer, puoi collegare il container a una VPN (es. con gluetun) o configurare un proxy.

## Variabili d'ambiente
Puoi configurare le variabili tramite file `.env` (vedi `example.env`) oppure direttamente nell'interfaccia Portainer.

| Variabile                        | Descrizione                                                                 |
|----------------------------------|-----------------------------------------------------------------------------|
| `GITHUB_TOKEN`                   | **Obbligatorio.** Token GitHub personale con permesso `gist`                |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Lascia `true` in Docker                                                     |
| `PUPPETEER_EXECUTABLE_PATH`      | Lascia `/usr/bin/chromium` in Docker, vuoto su Windows                      |
| `NODE_ENV`                       | `production` consigliato                                                    |
| `ENABLE_GARBAGE_COLLECTION`      | `true` per abilitare la garbage collection manuale                          |
| `GC_INTERVAL`                    | Intervallo GC in ms (default 300000)                                        |
| `CACHE_TTL`                      | Tempo di cache in secondi (default 3600)                                    |
| `CF_COOKIE_MAX_AGE`              | Durata massima del cookie Cloudflare in ms (default 3600000)                |
| `CF_MAX_RETRY`                   | Numero massimo di tentativi per ottenere il cookie (default 2)              |
| `CF_RETRY_DELAY`                 | Ritardo iniziale tra i tentativi in ms (default 2000)                       |

### Come ottenere un token GitHub per i Gist
1. Vai su https://github.com/settings/tokens
2. Clicca su "Generate new token"
3. Seleziona solo lo scope `gist`
4. Copia il token e impostalo nella variabile `GITHUB_TOKEN`

## Deploy con Docker Compose

Il metodo consigliato è utilizzare l'immagine Docker pre-compilata, che garantisce la compatibilità multi-architettura (amd64 e arm64).

1.  Crea un file `.env` (puoi copiare `example.env`) e inserisci il tuo `GITHUB_TOKEN`.
2.  Crea un file `docker-compose.yml` con il seguente contenuto.
3.  Esegui il comando `docker-compose up -d`.

```yaml
version: '3.8'
services:
  baciasiatici-addon:
    image: your-dockerhub-username/baciasiatici-addon:latest # Sostituisci con l'immagine corretta
    container_name: baciasiatici
    ports:
      - "3000:3000"
    volumes:
      - ./cache:/app/cache
      - ./data:/app/data
    env_file:
      - .env
    restart: unless-stopped
    mem_limit: 512m
    cpus: 0.5
```

## Deploy su Portainer
1. Crea uno stack o container usando la configurazione sopra
2. Imposta le variabili d'ambiente richieste (in particolare `GITHUB_TOKEN` e, se serve, le variabili Puppeteer)
3. Assicurati che il container abbia un IP italiano (VPN/proxy)
4. Avvia il container

## Note
- Le cartelle `cache/` e `data/` sono persistenti e possono essere montate come volumi
- Puoi copiare `example.env` in `.env` e modificarlo secondo le tue esigenze
- Per problemi con Chromium su Windows, assicurati che la variabile `PUPPETEER_EXECUTABLE_PATH` sia vuota

---

Per qualsiasi problema o richiesta, apri una issue sul repository o contatta lo sviluppatore.
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
4. Controlla i log del container per eventuali errori. All'avvio, un messaggio indicherà l'architettura rilevata (es. `x64` per AMD/Intel, `arm64` per Apple Silicon/Raspberry Pi).

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


+### Come Costruire l'Immagine Multi-Architettura (Opzionale) + +Se desideri costruire e pubblicare la tua versione dell'immagine Docker compatibile con più architetture (amd64 e arm64), puoi usare docker buildx. Questo è utile se hai fatto modifiche al codice e vuoi distribuirle. + +1. Assicurati che buildx sia abilitato. Di solito è standard nelle versioni recenti di Docker Desktop. + +2. Crea un nuovo "builder" (se non ne hai già uno):

sh
docker buildx create --name mybuilder --use
plaintext
+3. Esegui la build e pubblicala sul tuo registry (es. Docker Hub):

Sostituisci your-dockerhub-username con il tuo username. La pubblicazione (--push) è necessaria per le immagini multi-architettura.
sh
docker buildx build --platform linux/amd64,linux/arm64 -t your-dockerhub-username/baciasiatici-addon:latest --push .

## 🎬 Uso

1. Cerca contenuti direttamente dalla home di Stremio
2. I sottotitoli italiani sono caricati automaticamente
3. Supporta ricerca per titolo e ID esterni

## 📝 Note

- Versione: **2.0.1**
- Ricerca intelligente con stop automatico
- Performance ottimizzate per Stremio

---

*Addon sviluppato per contenuti asiatici con focus sui sottotitoli italiani*
