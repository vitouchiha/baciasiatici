<p align="center">
  <img src="https://imgur.com/PVEr4oa.jpeg" alt="logo" width="200"/>
</p>

<h1 align="center">KissKH Stremio Addon (BaciAsiatici)</h1>

<p align="center">
  Addon Stremio per accedere al catalogo KissKH con un focus sui sottotitoli in italiano.
</p>

---

## ⚠️ Requisiti Fondamentali

1.  **IP Italiano Obbligatorio**: Per ottenere i sottotitoli auto-generati da KissKH, il container dell'addon **deve** avere un indirizzo IP italiano. Puoi utilizzare una VPN (es. gluetun), un proxy residenziale o un server hostato in Italia.
2.  **Token GitHub**: È necessario un token di accesso personale da GitHub con permesso `gist` per salvare e servire i sottotitoli decriptati.

## ✨ Funzionalità

-   Accesso al catalogo di serie TV di KissKH.
-   Recupero automatico dei sottotitoli in italiano.
-   Supporto per la ricerca tramite titolo.
-   Matching intelligente con ID esterni di Stremio (IMDb, TMDB).
-   Immagine Docker multi-architettura (`amd64` e `arm64`) per la massima compatibilità.

## 🚀 Deploy con Docker (Consigliato)

Il metodo più semplice è utilizzare l'immagine Docker pre-compilata e `docker-compose`.

1.  **Crea il file `.env`**:
    Copia il file `example.env` in `.env` e inserisci il tuo `GITHUB_TOKEN`.
    ```sh
    cp example.env .env
    ```

2.  **Crea il file `docker-compose.yml`**:
    ```yaml
    version: '3.8'
    services:
      baciasiatici-addon:
        # Immagine multi-architettura (amd64/arm64)
        image: your-dockerhub-username/baciasiatici-addon:latest # Sostituisci con la tua immagine
        container_name: baciasiatici
        ports:
          - "3000:3000"
        volumes:
          - ./cache:/app/cache # Cache per sottotitoli e dati temporanei
          - ./data:/app/data   # Dati persistenti dell'applicazione
        env_file:
          - .env
        restart: unless-stopped
        # Limiti consigliati per evitare un consumo eccessivo di risorse
        mem_limit: 512m
        cpus: 0.5
    ```

3.  **Avvia il container**:
    ```sh
    docker-compose up -d
    ```

L'addon sarà disponibile all'indirizzo `http://<tuo-ip>:3000`.

## Variabili d'ambiente

Configura queste variabili nel tuo file `.env` o direttamente nella piattaforma di deploy.

| Variabile | Descrizione | Default |
|---|---|---|
| `GITHUB_TOKEN` | **Obbligatorio.** Token GitHub con permesso `gist`. | `""` |
| `ENABLE_GARBAGE_COLLECTION` | Abilita la garbage collection manuale per gestire la memoria. | `true` |
| `GC_INTERVAL` | Intervallo GC in ms. | `300000` |
| `CF_COOKIE_MAX_AGE` | Durata massima del cookie Cloudflare in ms. | `3600000` |
| `CF_MAX_RETRY` | Numero massimo di tentativi per il bypass di Cloudflare. | `3` |
| `CF_RETRY_DELAY` | Ritardo tra i tentativi in ms. | `5000` |
| `CACHE_TTL` | Tempo di vita della cache in secondi. | `3600` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Lasciare `true` in Docker. | `true` |
| `PUPPETEER_EXECUTABLE_PATH` | Path di Chromium nel container. | `/usr/bin/chromium` |

## 🐙 Come Ottenere un Token GitHub

1.  Vai su **GitHub Tokens**.
2.  **Note**: Dai un nome al token (es. "KissKH Addon").
3.  **Expiration**: Imposta una scadenza (consigliato).
4.  **Select scopes**: Seleziona solo lo scope `gist`.
5.  Clicca su **"Generate token"**.
6.  **Copia il token** e salvalo nel tuo file `.env` come `GITHUB_TOKEN`.

## 🏗️ Costruire l'Immagine Docker (Opzionale)

Se hai modificato il codice e vuoi costruire la tua immagine multi-architettura (`amd64` e `arm64`), usa `docker buildx`.

1.  **Crea un builder `buildx`** (se non ne hai uno):
    ```sh
    docker buildx create --name mybuilder --use
    ```

2.  **Costruisci e pubblica l'immagine**:
    Sostituisci `your-dockerhub-username` con il tuo username di Docker Hub. Il flag `--push` è necessario per pubblicare il manifest multi-architettura.
    ```sh
    docker buildx build --platform linux/amd64,linux/arm64 -t your-dockerhub-username/baciasiatici-addon:latest --push .
    ```

## 🤔 Risoluzione dei Problemi

-   **Problemi con Cloudflare**:
    1.  Verifica che l'IP del container sia italiano.
    2.  Aumenta i valori di `CF_MAX_RETRY` e `CF_RETRY_DELAY` nel file `.env`.
    3.  Controlla i log (`docker-compose logs -f`) per errori specifici.

-   **Verifica Architettura**: All'avvio, i log mostreranno l'architettura in uso (es. `[System] Addon in esecuzione su architettura: x64`). Questo conferma che Docker ha scelto l'immagine corretta.

-   **Consumo di Memoria**: Puppeteer (Chromium) può essere intensivo. I limiti di `512m` di RAM e `0.5` CPU nel `docker-compose.yml` sono un buon punto di partenza per evitare problemi di performance.

---

*Addon sviluppato per contenuti asiatici con focus sui sottotitoli italiani*
