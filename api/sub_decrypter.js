const crypto = require('crypto');

const KEYS = [
    { key: Buffer.from('8056483646328763'), iv: Buffer.from('6852612370185273') },
    { key: Buffer.from('AmSmZVcH93UQUezi'), iv: Buffer.from('ReBKWW8cqdjPEnF6') },
    { key: Buffer.from('sWODXX04QRTkHdlZ'), iv: Buffer.from('8pwhapJeC4hrS9hO') }
];

function decryptLine(line) {
    for (const { key, iv } of KEYS) {
        try {
            const buf = Buffer.from(line, 'base64');
            if (buf.length < 8) continue;
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            decipher.setAutoPadding(true);
            let decrypted = decipher.update(buf);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            const text = decrypted.toString('utf8').trim();
            // Se la riga decriptata contiene almeno una lettera o spazio, restituisci
            if (/[a-zA-Zà-ÿÀ-Ÿ\s]/.test(text)) {
                return text;
            }
        } catch (e) {
            continue;
        }
    }
    return line;
}

function decryptKisskhSubtitleFull(srtText) {
    let text = srtText
        .split('\n')
        .map(line => {
            if (/^[A-Za-z0-9+\/=]{16,}$/.test(line.trim())) {
                return decryptLine(line.trim());
            }
            return line;
        })
        .join('\n');
    // Decodifica le entità HTML
    text = decodeHtmlEntities(text);
    // Normalizza i fine riga (opzionale, ma consigliato)
    text = text.replace(/\r?\n/g, '\r\n');
    return text;
}

function decodeHtmlEntities(text) {
    return text
        .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

module.exports = { 
    decryptKisskhSubtitleFull,
    decodeHtmlEntities,
    };

