# Usa una base Node.js ufficiale
FROM node:24-slim

# Installa dipendenze di sistema necessarie per Puppeteer/Chromium
RUN apt-get update && \
    apt-get install -y \
        wget \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
        --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia package.json e package-lock.json
COPY package*.json ./

# Installa le dipendenze Node.js (incluso puppeteer-extra e plugin)
RUN npm install

# Copia il resto del codice dell'addon
COPY . .

# Imposta variabile d'ambiente per Puppeteer (evita errori sandbox in Docker)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Scarica manualmente Chromium (Puppeteer userà quello del sistema)
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Espone la porta 3000 (o quella che usi nel tuo index.js)
EXPOSE 3000

# Avvio del server
CMD ["node", "index.js"]
