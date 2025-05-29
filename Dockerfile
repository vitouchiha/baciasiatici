FROM node:18-slim

# Installa solo i pacchetti essenziali per Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Imposta variabili d'ambiente per Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    CACHE_TTL=3600 \
    ENABLE_GARBAGE_COLLECTION=true \
    GC_INTERVAL=300000 \
    CF_COOKIE_MAX_AGE=3600000 \
    CF_MAX_RETRY=3 \
    CF_RETRY_DELAY=5000

# Crea directory app
WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Installa dipendenze in modalità produzione
RUN npm ci --only=production

# Crea directory per i dati e aggiunge un cookie Cloudflare predefinito
RUN mkdir -p /app/data
RUN echo '{"cf_clearance":"placeholder_value","timestamp":0}' > /app/data/cf_cookie.json

# Copia il codice sorgente
COPY . .

# Espone la porta su cui gira l'app
EXPOSE 3000

# Avvia l'app con limiti di memoria e garbage collection abilitata
CMD ["node", "--max-old-space-size=512", "--expose-gc", "index.js"]