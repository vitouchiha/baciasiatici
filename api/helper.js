/**
 * Helper functions for KissKH Stremio Addon
 * Contains utility functions for title processing, similarity calculation, and ID handling
 */

// Cache per i titoli cercati
const titleSearchCache = new Map();

/**
 * Pulisce un titolo per la ricerca rimuovendo caratteri speciali e normalizzando
 * @param {string} title - Il titolo da pulire
 * @returns {string} - Il titolo pulito
 */
function cleanTitleForSearch(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ一-龯]/g, ' ') // Mantieni caratteri coreani, cinesi e giapponesi
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calcola la similarità tra due titoli
 * @param {string} title1 - Primo titolo
 * @param {string} title2 - Secondo titolo
 * @returns {number} - Valore tra 0 e 1 che indica la similarità
 */
function titleSimilarity(title1, title2) {
    const clean1 = cleanTitleForSearch(title1);
    const clean2 = cleanTitleForSearch(title2);
    
    if (clean1 === clean2) return 1.0;
    if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.8;
    
    // Calcolo di similarità basato su parole in comune
    const words1 = clean1.split(' ').filter(w => w.length > 2);
    const words2 = clean2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const common = words1.filter(w => words2.includes(w)).length;
    const total = Math.max(words1.length, words2.length);
    
    return common / total;
}

/**
 * Estrae il titolo da un ID esterno (TMDB, IMDB, etc.)
 * @param {string} id - L'ID esterno da processare
 * @returns {string|null} - Il titolo estratto o null se non possibile
 */
function extractTitleFromExternalId(id) {
    // Gestisce vari formati di ID esterni che potrebbero contenere il titolo
    if (id.includes(':')) {
        const parts = id.split(':');
        // Per ID come "tt1234567:series-title" o "tmdb:12345:series-title"
        if (parts.length >= 2) {
            // Se la prima parte è un ID numerico o prefisso, usa il resto
            const firstPart = parts[0];
            if (firstPart.match(/^(tt|tmdb|imdb)\d+/) || (!isNaN(firstPart) && firstPart.length > 3)) {
                return parts.slice(1).join(' ').replace(/-/g, ' ');
            }
            // Se contiene 'tmdb' come prefisso e poi un numero
            if (firstPart === 'tmdb' && parts.length > 2) {
                return parts.slice(2).join(' ').replace(/-/g, ' ');
            }
            // Se la seconda parte è un anno, usa la prima
            if (parts.length === 2 && parts[1].match(/^\d{4}$/)) {
                return parts[0].replace(/-/g, ' ');
            }
        }
    }
    
    // Se l'ID sembra essere un titolo con trattini (ma non inizia con prefissi tecnici)
    if (id.includes('-') && !id.match(/^(tt|tmdb|imdb)\d+/)) {
        return id.replace(/-/g, ' ');
    }
    
    return null;
}

/**
 * Cerca una serie per titolo nel catalogo KissKH
 * @param {string} searchTitle - Il titolo da cercare
 * @param {number} limit - Numero massimo di risultati (default: 5)
 * @param {Function} getCatalogFunction - Funzione per ottenere il catalogo
 * @returns {Promise<Array>} - Array di risultati ordinati per similarità
 */
async function searchSeriesByTitle(searchTitle, limit = 5, getCatalogFunction) {
    const cacheKey = `title_search_${cleanTitleForSearch(searchTitle)}`;
    
    // Controlla cache
    if (titleSearchCache.has(cacheKey)) {
        const cached = titleSearchCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 30 * 60 * 1000) { // 30 minuti
            console.log(`[TitleSearch] Cache hit for: ${searchTitle}`);
            return cached.results;
        }
    }
    
    try {
        console.log(`[TitleSearch] Searching for: "${searchTitle}"`);
        
        // Prima cerca esattamente con il titolo
        let results = await getCatalogFunction({ page: 1, limit: 20, search: searchTitle });
        
        // Se non trova risultati, prova con parti del titolo
        if (results.length === 0) {
            const cleanTitle = cleanTitleForSearch(searchTitle);
            const words = cleanTitle.split(' ').filter(w => w.length > 2);
            
            if (words.length > 0) {
                // Prova con le parole più lunghe
                const longestWords = words.sort((a, b) => b.length - a.length).slice(0, 2);
                const searchTerm = longestWords.join(' ');
                console.log(`[TitleSearch] Retry with keywords: "${searchTerm}"`);
                results = await getCatalogFunction({ page: 1, limit: 20, search: searchTerm });
            }
        }
        
        // Ordina i risultati per similarità
        const scoredResults = results.map(series => ({
            ...series,
            similarity: titleSimilarity(searchTitle, series.name)
        })).filter(r => r.similarity > 0.3) // Soglia minima di similarità
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
        
        console.log(`[TitleSearch] Found ${scoredResults.length} matches for "${searchTitle}"`);
        scoredResults.forEach(r => {
            console.log(`[TitleSearch] - "${r.name}" (similarity: ${r.similarity.toFixed(2)})`);
        });
        
        // Salva in cache
        titleSearchCache.set(cacheKey, {
            results: scoredResults,
            timestamp: Date.now()
        });
        
        return scoredResults;
    } catch (error) {
        console.error(`[TitleSearch] Error searching for "${searchTitle}":`, error.message);
        return [];
    }
}

/**
 * Verifica se un sottotitolo è in italiano
 * @param {Object} subtitle - Oggetto sottotitolo con proprietà language, label, lang
 * @param {string} url - URL del sottotitolo (opzionale)
 * @returns {boolean} - True se il sottotitolo è italiano
 */
function isItalianSubtitle(subtitle, url) {
    const check = (str) => str && str.toLowerCase().includes('it');
    return check(subtitle.language) || 
           check(subtitle.label) || 
           check(subtitle.lang) ||
           (url && (url.toLowerCase().includes('.it.txt1') || 
                   url.toLowerCase().includes('.it.srt') || 
                   url.toLowerCase().includes('.it.txt') ||
                   url.toLowerCase().includes('/it/') ||
                   url.toLowerCase().includes('italian')));
}

/**
 * Verifica se il contenuto è un file SRT valido
 * @param {string|Buffer} content - Contenuto del file
 * @returns {boolean} - True se è un SRT valido
 */
function isValidSRT(content) {
    if (!content) return false;
    const text = typeof content === 'string' ? content : content.toString('utf8');
    return text.trim().match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/);
}

/**
 * Pulisce la cache dei titoli rimuovendo le voci scadute
 * @param {number} maxAge - Età massima in millisecondi (default: 30 minuti)
 */
function cleanTitleSearchCache(maxAge = 30 * 60 * 1000) {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, value] of titleSearchCache.entries()) {
        if (now - value.timestamp > maxAge) {
            titleSearchCache.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`[TitleSearchCache] Cleaned ${cleanedCount} expired entries`);
    }
}

/**
 * Ottiene statistiche sulla cache dei titoli
 * @returns {Object} - Oggetto con statistiche della cache
 */
function getTitleSearchCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, value] of titleSearchCache.entries()) {
        if (now - value.timestamp < 30 * 60 * 1000) {
            validEntries++;
        } else {
            expiredEntries++;
        }
    }
    
    return {
        totalEntries: titleSearchCache.size,
        validEntries,
        expiredEntries,
        hitRate: validEntries / (validEntries + expiredEntries) || 0
    };
}

module.exports = {
    cleanTitleForSearch,
    titleSimilarity,
    extractTitleFromExternalId,
    searchSeriesByTitle,
    isItalianSubtitle,
    isValidSRT,
    cleanTitleSearchCache,
    getTitleSearchCacheStats
};
