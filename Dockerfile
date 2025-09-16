FROM node:18-slim

# Installa i pacchetti essenziali per Chromium.
# Il pacchetto 'chromium' è disponibile per le architetture amd64 e arm64 su Debian,
# rendendo l'immagine compatibile con entrambe le piattaforme.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Imposta variabili d'ambiente per l'applicazione
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    CACHE_TTL=3600 \
    ENABLE_GARBAGE_COLLECTION=true \
    GC_INTERVAL=300000 \
    CF_COOKIE_MAX_AGE=3600000 \
    CF_MAX_RETRY=3 \
    CF_RETRY_DELAY=5000 \
    GITHUB_TOKEN=""

WORKDIR /app

# Copia i file di definizione delle dipendenze per sfruttare il caching di Docker
COPY package*.json ./

# Installa le dipendenze di produzione
RUN npm ci --only=production

# Copia il resto dei file dell'applicazione
COPY . .

# Crea le directory per cache/dati (se non esistono) e imposta il proprietario corretto per l'intera app.
RUN mkdir -p cache data && chown -R node:node .

# Passa all'utente non-root
USER node

# Espone la porta su cui gira l'app
EXPOSE 3000

# Avvia l'app con limiti di memoria e garbage collection abilitata
CMD ["node", "--max-old-space-size=512", "--expose-gc", "index.js"]