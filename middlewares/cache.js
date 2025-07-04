const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');

// Inizializza Octokit con il token GitHub
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

class Cache {
    constructor(ttl = 24 * 60 * 60 * 1000) { // 24 hours default TTL
        this.cacheDir = path.join(process.cwd(), 'cache');
        this.ttl = ttl;
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            this.cleanOldCache();
        } catch (error) {
            console.error('Cache initialization error:', error);
        }
    }

    async cleanOldCache() {
        try {
            const files = await fs.readdir(this.cacheDir);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtime.getTime() > this.ttl) {
                    await fs.unlink(filePath);
                    console.log(`Deleted expired cache file: ${file}`);
                }
            }
        } catch (error) {
            console.error('Cache cleaning error:', error);
        }
    }

    getCacheKey(key) {
        return crypto.createHash('md5').update(key).digest('hex');
    }

    async set(key, data) {
        const cacheKey = this.getCacheKey(key);
        const filePath = path.join(this.cacheDir, cacheKey);

        try {
            await fs.writeFile(filePath, JSON.stringify({
                timestamp: Date.now(),
                data
            }));
            return true;
        } catch (error) {
            console.error('Cache write error:', error);
            return false;
        }
    }

    async get(key) {
        const cacheKey = this.getCacheKey(key);
        const filePath = path.join(this.cacheDir, cacheKey);

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const { timestamp, data } = JSON.parse(content);

            if (Date.now() - timestamp > this.ttl) {
                await fs.unlink(filePath);
                return null;
            }

            return data;
        } catch (error) {
            return null;
        }
    }

    async setSRT(key, content, lang, encrypted = false) {
        if (!content) {
            console.error('[cache] Attempt to save empty or undefined content');
            return null;
        }

        if (lang.toLowerCase() !== 'it') {
            console.log(`[cache] Skipping non-Italian subtitle for key: ${key}`);
            return null;
        }

        const cacheKey = this.getCacheKey(`${key}_${lang.toLowerCase()}`);
        // Se il contenuto è criptato, salva come .txt1, altrimenti come .srt
        // Aggiungiamo supporto anche per .txt per file criptati alternativi
        const extension = encrypted ? 'txt1' : 'srt';
        const fileName = `${cacheKey}.${extension}`;
        const filePath = path.join(this.cacheDir, fileName);

        try {
            const dataToWrite = Buffer.isBuffer(content) ? content : Buffer.from(content);
            await fs.writeFile(filePath, dataToWrite);
            console.log(`[cache] Saved subtitle: ${fileName}`);
            return filePath;
        } catch (error) {
            console.error('[cache] Subtitle write error:', error);
            return null;
        }
    }

    async getSRT(key, lang) {
        if (lang.toLowerCase() !== 'it') {
            return null;
        }

        const cacheKey = this.getCacheKey(`${key}_${lang.toLowerCase()}`);
        // Prova prima .txt1, poi .txt, infine .srt
        const extensions = ['txt1', 'txt', 'srt'];
        
        for (const ext of extensions) {
            const fileName = `${cacheKey}.${ext}`;
            const filePath = path.join(this.cacheDir, fileName);
            const exists = await fs.access(filePath).then(() => true).catch(() => false);
            
            if (exists) {
                try {
                    const stats = await fs.stat(filePath);
                    if (Date.now() - stats.mtime.getTime() > this.ttl) {
                        await fs.unlink(filePath);
                        continue; // Prova la prossima estensione
                    }

                    const content = await fs.readFile(filePath);
                    const isEncrypted = ext === 'txt1' || ext === 'txt';
                    return { 
                        content: content.toString('utf8'),
                        filePath,
                        fileName: path.basename(filePath),
                        isEncrypted
                    };
                } catch (error) {
                    console.error(`[cache] Error reading subtitle ${fileName}:`, error);
                    continue; // Prova la prossima estensione
                }
            }
        }

        return null;
    }

    async createGistFromSubtitle(content, description) {
        if (!process.env.GITHUB_TOKEN) {
            console.error('[Gist] GITHUB_TOKEN non impostato');
            throw new Error('GITHUB_TOKEN is required but not set');
        }

        try {
            const response = await octokit.gists.create({
                files: {
                    'subtitle.srt': {
                        content: content
                    }
                },
                description: description,
                public: true
            });
            
            if (!response.data.files['subtitle.srt']?.raw_url) {
                throw new Error('Gist creation succeeded but raw_url is missing');
            }

            const gistUrl = response.data.files['subtitle.srt'].raw_url;
            console.log(`[Gist] Created successfully: ${gistUrl}`);
            return gistUrl;
        } catch (error) {
            if (error.status === 401) {
                console.error('[Gist] Authentication failed. Check your GITHUB_TOKEN');
            } else if (error.status === 403) {
                console.error('[Gist] Rate limit exceeded or token lacks gist scope');
            } else {
                console.error('[Gist] Error creating gist:', error.message);
            }
            throw error;
        }
    }

    async setSRTWithGist(key, content, lang = 'it') {
        if (!content) {
            console.log(`[cache] No content provided for key: ${key}`);
            return null;
        }

        if (lang.toLowerCase() !== 'it') {
            console.log(`[cache] Skipping non-Italian subtitle for key: ${key}`);
            return null;
        }

        // Prima controlla se abbiamo già un URL cached per questo sottotitolo
        const cacheKey = this.getCacheKey(`${key}_${lang.toLowerCase()}`);
        const cached = await this.get(cacheKey);
        if (cached?.url) {
            console.log(`[cache] Found cached gist URL for ${key}`);
            return cached.url;
        }

        try {
            // Crea il gist
            const gistUrl = await this.createGistFromSubtitle(content, `Subtitle for ${key}`);
            
            // Salva l'URL del gist nella cache
            await this.set(cacheKey, {
                url: gistUrl,
                timestamp: Date.now()
            });

            return gistUrl;
        } catch (error) {
            console.error(`[cache] Error saving subtitle to gist for ${key}:`, error.message);
            return null;
        }
    }
}

module.exports = new Cache();