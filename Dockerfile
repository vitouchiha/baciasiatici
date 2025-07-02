FROM node:18-slim

# Installa solo i pacchetti essenziali per Chromium
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

# Crea directory app e sottotitoli
WORKDIR /app
RUN mkdir -p subtitles && chown -R node:node subtitles

# Copia package.json e package-lock.json
COPY package*.json ./

# Installa dipendenze in modalità produzione
RUN npm ci --only=production

# Imposta permessi per la directory subtitles
RUN chmod 755 subtitles

# Copia il resto dei file
COPY . .

# Cambia proprietario dei file
RUN chown -R node:node .

# Passa all'utente non-root
USER node

# Espone la porta su cui gira l'app
EXPOSE 3000

# Avvia l'app con limiti di memoria e garbage collection abilitata
CMD ["node", "--max-old-space-size=512", "--expose-gc", "index.js"]