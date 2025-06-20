const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

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
    }    async get(key) {
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

    async setSRT(key, content, lang) {
        const cacheKey = this.getCacheKey(key);
        const filePath = path.join(this.cacheDir, `${cacheKey}.${lang}.srt`);

        try {
            // Verifica che il contenuto sia un SRT valido
            if (!content || !content.trim().match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/)) {
                console.error('Invalid SRT content:', content ? content.substring(0, 100) + '...' : 'empty');
                return null;
            }

            // Normalizza i fine riga per evitare problemi di compatibilità
            const normalizedContent = content.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
            
            await fs.writeFile(filePath, normalizedContent);
            const stats = await fs.stat(filePath);
            
            console.log(`[Cache] Salvato sottotitolo: ${path.basename(filePath)} (${(stats.size / 1024).toFixed(2)} KB)`);
            return filePath;
        } catch (error) {
            console.error(`[Cache] Errore durante il salvataggio del sottotitolo:`, error);
            return null;
        }
    }

    async getSRT(key, lang) {
        const cacheKey = this.getCacheKey(key);
        const filePath = path.join(this.cacheDir, `${cacheKey}.${lang}.srt`);

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const stats = await fs.stat(filePath);

            if (Date.now() - stats.mtime.getTime() > this.ttl) {
                await fs.unlink(filePath);
                return null;
            }

            return { content, filePath };
        } catch (error) {
            return null;
        }
    }

    async getAllSRTFiles(key) {
        try {
            const files = await fs.readdir(this.cacheDir);
            // Filtra solo i file dei sottotitoli italiani
            const langFiles = files.filter(f => 
                f.startsWith(this.getCacheKey(key)) && 
                (f.includes('.it.srt') || f.includes('.it.txt1'))
            );
            const results = [];
            
            for (const file of langFiles) {
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);
                
                if (Date.now() - stats.mtime.getTime() <= this.ttl) {
                    results.push({
                        lang: 'it',
                        filePath
                    });
                } else {
                    await fs.unlink(filePath);
                }
            }
            
            return results;
        } catch (error) {
            console.error('Error getting all SRT files:', error);
            return [];
        }
    }
}

module.exports = new Cache();
