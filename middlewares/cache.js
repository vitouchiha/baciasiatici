const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');

// Inizializza Octokit con il token se disponibile
const octokit = new Octokit(process.env.GITHUB_TOKEN ? {
    auth: process.env.GITHUB_TOKEN
} : {});

async function ensureSubtitlesDir() {
    const subtitlesDir = path.join(__dirname, '..', 'subtitles');
    try {
        await fs.access(subtitlesDir);
    } catch {
        await fs.mkdir(subtitlesDir, { recursive: true });
    }
    return subtitlesDir;
}

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
        // Prova prima .txt1, poi .srt
        const fileName = `${cacheKey}.txt1`;
        const filePath = path.join(this.cacheDir, fileName);
        let exists = await fs.access(filePath).then(() => true).catch(() => false);
        
        if (!exists) {
            const srtPath = path.join(this.cacheDir, `${cacheKey}.srt`);
            exists = await fs.access(srtPath).then(() => true).catch(() => false);
            if (!exists) return null;
        }

        try {
            const stats = await fs.stat(filePath);
            if (Date.now() - stats.mtime.getTime() > this.ttl) {
                await fs.unlink(filePath);
                return null;
            }

            const content = await fs.readFile(filePath);
            const isEncrypted = filePath.endsWith('.txt1');
            return { 
                content: content.toString('utf8'),
                filePath,
                fileName: path.basename(filePath),
                isEncrypted
            };
        } catch (error) {
            console.error('[cache] Error reading subtitle:', error);
            return null;
        }
    }

    async createGistFromSubtitle(content, description) {
        try {
            // Prima prova a creare un gist
            const response = await octokit.gists.create({
                files: {
                    'subtitle.srt': {
                        content: content
                    }
                },
                description: description,
                public: true
            });
            
            // Restituisci l'URL raw del gist
            const gistUrl = response.data.files['subtitle.srt'].raw_url;
            console.log(`[Gist] Created: ${gistUrl}`);
            return gistUrl;
        } catch (error) {
            console.error('[Gist] Error creating gist:', error);
            
            // Fallback: salva il file localmente
            try {
                const subtitlesDir = await ensureSubtitlesDir();
                const filename = `subtitle_${Date.now()}.srt`;
                const filePath = path.join(subtitlesDir, filename);
                await fs.writeFile(filePath, content, 'utf8');
                
                // Costruisci l'URL locale
                const domain = process.env.DOMAIN || 'localhost:7000';
                const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                const localUrl = `${protocol}://${domain}/subtitles/${filename}`;
                console.log(`[Fallback] Saved subtitle locally: ${localUrl}`);
                return localUrl;
            } catch (fallbackError) {
                console.error('[Fallback] Error saving subtitle locally:', fallbackError);
                return null;
            }
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

        try {
            // Crea il gist o usa il fallback locale
            const subtitleUrl = await this.createGistFromSubtitle(content, `Subtitle for ${key}`);
            if (!subtitleUrl) {
                throw new Error('Failed to create gist and local fallback');
            }

            // Salva l'URL nella cache
            const cacheKey = this.getCacheKey(`${key}_${lang.toLowerCase()}`);
            await this.set(cacheKey, {
                url: subtitleUrl,
                timestamp: Date.now()
            });

            return subtitleUrl;
        } catch (error) {
            console.error('[cache] Error saving subtitle:', error);
            return null;
        }
    }

    async getAllSRTFiles(key) {
        try {
            const files = await fs.readdir(this.cacheDir);
            // Filtra i file dei sottotitoli italiani (sia .srt che .txt1)
            const subtitleFiles = files.filter(f => 
                f.startsWith(this.getCacheKey(key)) && 
                (f.endsWith('.srt') || f.endsWith('.txt1')) &&
                f.toLowerCase().includes('_it.')
            );
            
            const results = [];
            
            for (const file of subtitleFiles) {
                const filePath = path.join(this.cacheDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    
                    if (Date.now() - stats.mtime.getTime() <= this.ttl) {
                        results.push({
                            lang: 'it',
                            filePath,
                            isEncrypted: file.endsWith('.txt1')
                        });
                    } else {
                        await fs.unlink(filePath);
                    }
                } catch (error) {
                    console.error(`[cache] Error processing file ${file}:`, error);
                    continue;
                }
            }
            
            return results;
        } catch (error) {
            console.error('[cache] Error getting subtitle files:', error);
            return [];
        }
    }
}

module.exports = new Cache();