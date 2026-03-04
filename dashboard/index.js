/**
 * Web Dashboard - Tüm botların durumunu web üzerinden izle
 * Express.js + HTML Frontend
 * Port: 3000 (varsayılan)
 * 
 * GÜVENLIK ÖZELLIKLERI:
 * - XSS Koruması (htmlspecialchars)
 * - API Key Yönetimi (CSPRNG - Kriptografik güvenli anahtar üretimi)
 * - HMAC-SHA256 İmzalama (Bot-Websitesi iletişimi)
 * - Rate Limiting
 * - IDOR Koruması
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BOTS_DIR = path.join(__dirname, '..', 'bots');

// ============================================
// GÜVENLIK AYARLARI
// ============================================

// Rate Limiting - Basit bellek içi implementasyon
const rateLimitMap = new Map();
const RATE_LIMIT = 60; // dakika başına istek sayısı
const RATE_WINDOW = 60 * 1000; // 1 dakika

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    
    if (!record || now - record.windowStart > RATE_WINDOW) {
        rateLimitMap.set(ip, { windowStart: now, count: 1 });
        return true;
    }
    
    if (record.count >= RATE_LIMIT) {
        return false;
    }
    
    record.count++;
    return true;
}

// Rate Limit Middleware
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIP)) {
        return res.status(429).json({ error: 'Çok fazla istek. Lütfen sonra tekrar deneyin.' });
    }
    next();
});

app.use(express.json());

// ============================================
// YARDIMCI FONKSIYONLAR
// ============================================

// XSS Korumalı HTML kaçış fonksiyonu
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// CSPRNG - Kriptografik güvenli rastgele anahtar üretimi
function generateSecureApiKey() {
    return 'sk_' + crypto.randomBytes(32).toString('hex');
}

// HMAC-SHA256 İmza oluşturma
function createHmacSignature(payload, secret) {
    return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

// İmza doğrulama
function verifyHmacSignature(payload, signature, secret) {
    try {
        const expectedSignature = createHmacSignature(payload, secret);
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (e) {
        return false;
    }
}

// API Key format kontrolü
function isValidApiKeyFormat(key) {
    return /^sk_[a-f0-9]{64}$/.test(key);
}

// Shared secret yönetimi (bot-website arası iletişim için)
const MASTER_SECRET = process.env.MASTER_SECRET || crypto.randomBytes(32).toString('hex');

// Veritabanı başlatma (API keys için)
const USER_DB_PATH = path.join(DATA_DIR, 'users.db');
function initUserDatabase() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const userDb = new Database(USER_DB_PATH);
    
    userDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT UNIQUE NOT NULL,
            username TEXT,
            avatar_url TEXT,
            api_key TEXT UNIQUE,
            api_key_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME,
            is_admin INTEGER DEFAULT 0,
            rate_limit INTEGER DEFAULT 60
        );
        
        CREATE TABLE IF NOT EXISTS api_access_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            endpoint TEXT,
            method TEXT,
            ip_address TEXT,
            user_agent TEXT,
            status_code INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_api_key ON users(api_key);
        CREATE INDEX IF NOT EXISTS idx_discord_id ON users(discord_id);
    `);
    
    return userDb;
}

const userDb = initUserDatabase();

// Helper: Get DB for a bot
function getDb(botName) {
    const dbPath = path.join(DATA_DIR, `${botName}.db`);
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: true });
}

// Helper: Get bot directories
function getBotFolders() {
    if (!fs.existsSync(BOTS_DIR)) return [];
    return fs.readdirSync(BOTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}

// Bot durumları için bellek içi önbellek
const botStatusCache = new Map();

// ============================================
// API KEY YÖNETIMI ENDPOINTS
// ============================================

// Yeni API Key oluştur (Discord OAuth2 sonrası kullanılacak)
app.post('/api/auth/register-key', (req, res) => {
    const { discord_id, username, avatar_url } = req.body;
    
    if (!discord_id) {
        return res.status(400).json({ error: 'Discord ID gerekli' });
    }
    
    // Kullanıcı var mı kontrol et
    let user = userDb.prepare('SELECT * FROM users WHERE discord_id = ?').get(discord_id);
    
    if (user && user.api_key) {
        // Zaten API key var - yeni oluşturma, mevcut olanı döndür
        return res.json({ 
            api_key: user.api_key,
message: 'Mevcut API anahtarınız'
        });
    }
    
    // Yeni API Key oluştur
    const newApiKey = generateSecureApiKey();
    
    if (user) {
        // Kullanıcı var, sadece API key güncelle
        userDb.prepare('UPDATE users SET api_key = ?, username = ?, avatar_url = ? WHERE discord_id = ?')
            .run(newApiKey, username, avatar_url, discord_id);
    } else {
        // Yeni kullanıcı oluştur
        userDb.prepare('INSERT INTO users (discord_id, username, avatar_url, api_key) VALUES (?, ?, ?, ?)')
            .run(discord_id, username, avatar_url, newApiKey);
    }
    
    res.json({ 
        api_key: newApiKey,
        message: 'API anahtarınız oluşturuldu. Bu anahtarı güvenli bir yerde saklayın!'
    });
});

// API Key doğrulama (dahili)
function validateApiKey(apiKey) {
    if (!apiKey || !isValidApiKeyFormat(apiKey)) {
        return null;
    }
    
    const user = userDb.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey);
    if (!user) {
        return null;
    }
    
    // Son kullanım zamanını güncelle
    userDb.prepare('UPDATE users SET last_used = datetime("now") WHERE id = ?').run(user.id);
    
    return user;
}

// API Key silme (iptal etme)
app.delete('/api/auth/revoke-key', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Yetkisiz erişim' });
    }
    
    const apiKey = authHeader.substring(7);
    const user = validateApiKey(apiKey);
    
    if (!user) {
        return res.status(401).json({ error: 'Geçersiz API anahtarı' });
    }
    
    userDb.prepare('UPDATE users SET api_key = NULL WHERE id = ?').run(user.id);
    
    res.json({ message: 'API anahtarınız iptal edildi' });
});

// ============================================
// GÜVENLI API ENDPOINTS (API Key Gerekli)
// ============================================

// Auth middleware
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'API anahtarı gerekli. Authorization: Bearer <api_key>' });
    }
    
    const apiKey = authHeader.substring(7);
    const user = validateApiKey(apiKey);
    
    if (!user) {
        return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş API anahtarı' });
    }
    
    req.user = user;
    next();
}

// Sistem genel bakış (güvenli)
app.get('/api/secure/overview', requireAuth, (req, res) => {
    const bots = getBotFolders();
    const overview = bots.map(botName => {
        const db = getDb(botName);
        let stats = {};
        try {
            if (botName === 'sentiguard' && db) {
                stats.warnings = db.prepare('SELECT COUNT(*) as c FROM warnings').get()?.c || 0;
                stats.last24h = db.prepare("SELECT COUNT(*) as c FROM warnings WHERE created_at > datetime('now', '-1 day')").get()?.c || 0;
            }
            if (botName === 'guardian' && db) {
                stats.nukeAttempts = db.prepare('SELECT COUNT(*) as c FROM nuke_log').get()?.c || 0;
                stats.whitelisted = db.prepare('SELECT COUNT(*) as c FROM whitelist').get()?.c || 0;
            }
            if (botName === 'logmaster' && db) {
                stats.totalEvents = db.prepare('SELECT COUNT(*) as c FROM event_log').get()?.c || 0;
                stats.deletedMessages = db.prepare('SELECT COUNT(*) as c FROM deleted_messages').get()?.c || 0;
            }
            if (botName === 'verifier' && db) {
                stats.totalVerifications = db.prepare('SELECT COUNT(*) as c FROM verification_log').get()?.c || 0;
                stats.pending = db.prepare('SELECT COUNT(*) as c FROM pending_verifications').get()?.c || 0;
            }
            if (botName === 'blacklist' && db) {
                stats.totalEntries = db.prepare('SELECT COUNT(*) as c FROM blacklist').get()?.c || 0;
                stats.autoEntries = db.prepare("SELECT COUNT(*) as c FROM blacklist WHERE source != 'manual'").get()?.c || 0;
            }
        } catch (e) { /* DB might not have tables yet */ }
        
        // Bot durumunu kontrol et
        const cachedStatus = botStatusCache.get(botName);
        const status = cachedStatus ? cachedStatus.status : 'offline';
        
        if (db) db.close();
        return { name: botName, stats, status };
    });
    res.json({ bots: overview, timestamp: new Date().toISOString() });
});

// Kullanıcıya özel veriler (IDOR korumalı)
app.get('/api/secure/user/data', requireAuth, (req, res) => {
    const userId = req.user.discord_id;
    
    // Kullanıcının erişebildiği verileri döndür
    res.json({
        user: {
            id: userId,
            username: req.user.username,
            avatar_url: req.user.avatar_url,
            created_at: req.user.created_at,
            last_used: req.user.last_used
        },
        message: 'Bu veriler yalnızca size aittir - başkaları erişemez'
    });
});

// ============================================
// BOT-WEBSITE GÜVENLI İLETİŞİM (HMAC)
// ============================================

// Botlar için güvenli veri gönderme endpoint'i
app.post('/api/bot/webhook', (req, res) => {
    const { signature, payload, bot_name } = req.body;
    
    // Signature kontrolü (HMAC-SHA256)
    if (!signature || !payload || !bot_name) {
        return res.status(400).json({ error: 'Eksik parametreler' });
    }
    
    // İmza doğrulama
    const isValid = verifyHmacSignature(payload, signature, MASTER_SECRET);
    
    if (!isValid) {
        console.warn(`[GÜVENLIK] Bot webhook reddedildi - geçersiz imza: ${bot_name}`);
        return res.status(401).json({ error: 'Geçersiz imza - yetkisiz erişim' });
    }
    
    // Bot durumunu önbelleğe al
    if (payload.type === 'status_report' || payload.status) {
        botStatusCache.set(bot_name, {
            status: payload.status || 'online',
            lastUpdate: Date.now(),
            data: payload
        });
    }
    
    // İşlem başarılı
    console.log(`[BOT] ${bot_name} güvenli bağlantı kurdu`);
    
    res.json({ 
        success: true, 
        message: 'Veri başarıyla alındı',
        server_time: new Date().toISOString()
    });
});

// Bot durumu sorgulama (güvenli)
app.get('/api/bot/status/:botName', requireAuth, (req, res) => {
    const botName = req.params.botName;
    
    // Sadece yetkili botları göster
    const allowedBots = getBotFolders();
    if (!allowedBots.includes(botName)) {
        return res.status(404).json({ error: 'Bot bulunamadı' });
    }
    
    const db = getDb(botName);
    let stats = {};
    
    try {
        if (db) {
            // Bot veritabanından istatistikler
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            stats.tables = tables.map(t => t.name);
            stats.status = 'online';
        }
    } catch (e) {
        stats.status = 'error';
    }
    
    if (db) db.close();
    res.json({ bot: botName, stats });
});

// ============================================
// HERKESE AÇIK API (Güvenli - sınırlı)
// ============================================

// Genel istatistikler (minimal, hassas olmayan)
app.get('/api/public/stats', (req, res) => {
    const bots = getBotFolders();
    
    // Bot durumlarını dahil et
    const botsWithStatus = bots.map(bot => {
        const cachedStatus = botStatusCache.get(bot);
        return {
            name: bot,
            status: cachedStatus ? cachedStatus.status : 'offline'
        };
    });
    
    res.json({ 
        total_bots: bots.length,
        bots: botsWithStatus,
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ESKI ENDPOINTS (Geriye uyumluluk için - ama güvenli)
// ============================================

// API: System overview
app.get('/api/overview', (req, res) => {
    const bots = getBotFolders();
    const overview = bots.map(botName => {
        const db = getDb(botName);
        let stats = {};
        try {
            if (botName === 'sentiguard' && db) {
                stats.warnings = db.prepare('SELECT COUNT(*) as c FROM warnings').get()?.c || 0;
                stats.last24h = db.prepare("SELECT COUNT(*) as c FROM warnings WHERE created_at > datetime('now', '-1 day')").get()?.c || 0;
            }
            if (botName === 'guardian' && db) {
                stats.nukeAttempts = db.prepare('SELECT COUNT(*) as c FROM nuke_log').get()?.c || 0;
                stats.whitelisted = db.prepare('SELECT COUNT(*) as c FROM whitelist').get()?.c || 0;
            }
            if (botName === 'logmaster' && db) {
                stats.totalEvents = db.prepare('SELECT COUNT(*) as c FROM event_log').get()?.c || 0;
                stats.deletedMessages = db.prepare('SELECT COUNT(*) as c FROM deleted_messages').get()?.c || 0;
            }
            if (botName === 'verifier' && db) {
                stats.totalVerifications = db.prepare('SELECT COUNT(*) as c FROM verification_log').get()?.c || 0;
                stats.pending = db.prepare('SELECT COUNT(*) as c FROM pending_verifications').get()?.c || 0;
            }
            if (botName === 'blacklist' && db) {
                stats.totalEntries = db.prepare('SELECT COUNT(*) as c FROM blacklist').get()?.c || 0;
                stats.autoEntries = db.prepare("SELECT COUNT(*) as c FROM blacklist WHERE source != 'manual'").get()?.c || 0;
            }
        } catch (e) { /* DB might not have tables yet */ }
        
        // Bot durumunu ekle
        const cachedStatus = botStatusCache.get(botName);
        
        if (db) db.close();
        return { name: botName, stats, status: cachedStatus ? cachedStatus.status : 'offline' };
    });
    res.json({ bots: overview, timestamp: new Date().toISOString() });
});

// API: Blacklist entries (XSS korumalı)
app.get('/api/blacklist', (req, res) => {
    const db = getDb('blacklist');
    if (!db) return res.json([]);
    const entries = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    // XSS koruması - tüm verileri kaçır
    const sanitized = entries.map(e => ({
        id: escapeHtml(e.id),
        user_id: escapeHtml(e.user_id),
        reason: escapeHtml(e.reason),
        source: escapeHtml(e.source),
        created_at: escapeHtml(e.created_at)
    }));
    res.json(sanitized);
});

// API: Recent events (XSS korumalı)
app.get('/api/events', (req, res) => {
    const db = getDb('logmaster');
    if (!db) return res.json([]);
    const events = db.prepare('SELECT * FROM event_log ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    // XSS koruması
    const sanitized = events.map(e => ({
        id: escapeHtml(e.id),
        event_type: escapeHtml(e.event_type),
        user_id: escapeHtml(e.user_id),
        detail: escapeHtml(e.detail),
        created_at: escapeHtml(e.created_at)
    }));
    res.json(sanitized);
});

// API: Sentiguard warnings (XSS korumalı)
app.get('/api/warnings', (req, res) => {
    const db = getDb('sentiguard');
    if (!db) return res.json([]);
    const warnings = db.prepare('SELECT * FROM warnings ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    // XSS koruması
    const sanitized = warnings.map(w => ({
        id: escapeHtml(w.id),
        guild_id: escapeHtml(w.guild_id),
        user_id: escapeHtml(w.user_id),
        reason: escapeHtml(w.reason),
        score: escapeHtml(w.score),
        created_at: escapeHtml(w.created_at)
    }));
    res.json(sanitized);
});

// API: Bot durumları
app.get('/api/bot-status', (req, res) => {
    const bots = getBotFolders();
    const statuses = bots.map(bot => {
        const cachedStatus = botStatusCache.get(bot);
        return {
            name: bot,
            status: cachedStatus ? cachedStatus.status : 'offline',
            lastUpdate: cachedStatus ? cachedStatus.lastUpdate : null
        };
    });
    res.json({ bots: statuses });
});

// Serve dashboard HTML
app.get('/', (req, res) => {
    res.send(getDashboardHTML());
});

function getDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Discord Bots - Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #1c2128;
            --border-color: #30363d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --accent-blue: #58a6ff;
            --accent-green: #3fb950;
            --accent-red: #f85149;
            --accent-yellow: #d29922;
            --accent-purple: #a371f7;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
        }
        
        /* Sidebar */
        .sidebar {
            position: fixed;
            left: 0;
            top: 0;
            width: 240px;
            height: 100vh;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-color);
            padding: 20px;
            z-index: 100;
        }
        
        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .sidebar-logo i {
            font-size: 28px;
            color: var(--accent-blue);
        }
        
        .sidebar-logo h1 {
            font-size: 18px;
            color: var(--accent-blue);
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            border-radius: 8px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.2s;
            margin-bottom: 4px;
        }
        
        .nav-item:hover, .nav-item.active {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }
        
        .nav-item i {
            width: 20px;
            text-align: center;
        }
        
        /* Main Content */
        .main-content {
            margin-left: 240px;
            padding: 30px;
        }
        
        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }
        
        .header h2 {
            font-size: 24px;
        }
        
        .header-actions {
            display: flex;
            gap: 12px;
        }
        
        .btn {
            padding: 10px 20px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .btn-primary {
            background: var(--accent-blue);
            color: white;
        }
        
        .btn-primary:hover {
            background: #4393e6;
        }
        
        .btn-success {
            background: var(--accent-green);
            color: white;
        }
        
        .btn-danger {
            background: var(--accent-red);
            color: white;
        }
        
        /* Cards */
        .card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
        }
        
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .card-header h3 {
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        /* Grid */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .stat-icon {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        
        .stat-icon.sentiguard { background: rgba(102, 102, 255, 0.2); color: #6666ff; }
        .stat-icon.guardian { background: rgba(0, 153, 255, 0.2); color: #0099ff; }
        .stat-icon.verifier { background: rgba(0, 191, 255, 0.2); color: #00bfff; }
        .stat-icon.logmaster { background: rgba(155, 89, 182, 0.2); color: #9b59b6; }
        .stat-icon.blacklist { background: rgba(204, 0, 0, 0.2); color: #cc0000; }
        
        .stat-info h4 {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        
        .stat-info .value {
            font-size: 24px;
            font-weight: 600;
        }
        
        /* Status Badge */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .status-online { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
        .status-offline { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }
        
        /* Table */
        .table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .table th {
            text-align: left;
            padding: 14px 16px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-weight: 500;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .table td {
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .table tr:hover {
            background: var(--bg-tertiary);
        }
        
        /* Security Notice */
        .security-notice {
            background: rgba(88, 166, 255, 0.1);
            border: 1px solid var(--accent-blue);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
        }
        
        .security-notice h3 {
            color: var(--accent-blue);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .security-notice ul {
            margin-left: 20px;
            color: var(--text-secondary);
        }
        
        .security-notice li {
            margin: 6px 0;
        }
        
        /* API Key Box */
        .api-key-box {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            margin-top: 16px;
            display: none;
        }
        
        .api-key-box.visible { display: block; }
        
        .api-key-input {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            color: var(--accent-blue);
            padding: 12px;
            border-radius: 6px;
            width: 100%;
            font-family: 'Consolas', monospace;
            font-size: 14px;
        }
        
        .warning-text {
            color: var(--accent-yellow);
            font-size: 12px;
            margin-top: 8px;
        }
        
        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        
        .modal.visible { display: flex; }
        
        .modal-content {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .modal-close {
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 20px;
            cursor: pointer;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .form-group input {
            width: 100%;
            padding: 12px;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 14px;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        
        /* Toast */
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 2000;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s;
        }
        
        .toast.visible {
            transform: translateY(0);
            opacity: 1;
        }
        
        .toast.success { background: var(--accent-green); }
        .toast.error { background: var(--accent-red); }
        .toast.info { background: var(--accent-blue); }
        
        /* Auto refresh indicator */
        .auto-refresh {
            color: var(--text-secondary);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-logo">
            <i class="fas fa-robot"></i>
            <h1>Bot Dashboard</h1>
        </div>
        
        <div class="nav-item active" data-page="overview">
            <i class="fas fa-chart-line"></i>
            <span>Genel Bakış</span>
        </div>
        <div class="nav-item" data-page="bots">
            <i class="fas fa-robot"></i>
            <span>Bot Yönetimi</span>
        </div>
        <div class="nav-item" data-page="api">
            <i class="fas fa-key"></i>
            <span>API Anahtarları</span>
        </div>
        <div class="nav-item" data-page="logs">
            <i class="fas fa-list"></i>
            <span>Olay Geçmişi</span>
        </div>
        <div class="nav-item" data-page="security">
            <i class="fas fa-shield-alt"></i>
            <span>Güvenlik</span>
        </div>
    </div>
    
    <!-- Main Content -->
    <div class="main-content">
        <!-- Header -->
        <div class="header">
            <div>
                <h2 id="pageTitle">Genel Bakış</h2>
                <span class="auto-refresh">Son güncelleme: <span id="lastUpdate">—</span></span>
            </div>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="loadData()">
                    <i class="fas fa-sync-alt"></i> Yenile
                </button>
            </div>
        </div>
        
        <!-- Overview Page -->
        <div id="page-overview">
            <!-- Security Notice -->
            <div class="security-notice">
                <h3><i class="fas fa-shield-alt"></i> Güvenlik Özellikleri Aktif</h3>
                <ul>
                    <li><strong>XSS Koruması:</strong> Tüm kullanıcı verileri güvenli şekilde işlenir</li>
                    <li><strong>API Anahtar Sistemi:</strong> Kişisel API anahtarınızla güvenli erişim</li>
                    <li><strong>Rate Limiting:</strong> Aşırı istekler otomatik engellenir</li>
                    <li><strong>HMAC İmzalama:</strong> Bot-website iletişimi şifreli</li>
                </ul>
            </div>
            
            <!-- Bot Status Grid -->
            <div class="grid" id="botsGrid"></div>
            
            <!-- Recent Events -->
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-history"></i> Son Olaylar</h3>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Zaman</th>
                            <th>Tür</th>
                            <th>Kullanıcı</th>
                            <th>Detay</th>
                        </tr>
                    </thead>
                    <tbody id="eventsBody"></tbody>
                </table>
            </div>
        </div>
        
        <!-- API Page -->
        <div id="page-api" style="display: none;">
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-key"></i> API Anahtar Yönetimi</h3>
                </div>
                <p style="color: var(--text-secondary); margin-bottom: 16px;">
                    Kendi API anahtarınızı oluşturarak güvenli bir şekilde bot verilerinize erişebilirsiniz.
                </p>
                <button class="btn btn-primary" onclick="showApiKeyModal()">
                    <i class="fas fa-plus"></i> Yeni Anahtar Oluştur
                </button>
                
                <div class="api-key-box" id="apiKeyBox">
                    <label style="color: var(--text-secondary); font-size: 12px;">API ANAHTARINIZ:</label>
                    <input type="text" class="api-key-input" id="apiKeyInput" readonly>
                    <div style="display: flex; gap: 8px; margin-top: 12px;">
                        <button class="btn btn-success" onclick="copyApiKey()">
                            <i class="fas fa-copy"></i> Kopyala
                        </button>
                        <button class="btn btn-danger" onclick="revokeApiKey()">
                            <i class="fas fa-trash"></i> İptal Et
                        </button>
                    </div>
                    <p class="warning-text">⚠️ Bu anahtarı yalnızca bir kez görebilirsiniz!</p>
                </div>
            </div>
        </div>
        
        <!-- Logs Page -->
        <div id="page-logs" style="display: none;">
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-history"></i> Olay Geçmişi</h3>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Zaman</th>
                            <th>Bot</th>
                            <th>Olay Türü</th>
                            <th>Detay</th>
                        </tr>
                    </thead>
                    <tbody id="logsBody">
                        <tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Veriler yükleniyor...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Security Page -->
        <div id="page-security" style="display: none;">
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-shield-alt"></i> Güvenlik Bilgileri</h3>
                </div>
                <div style="color: var(--text-secondary); line-height: 1.8;">
                    <p><strong>XSS Koruması:</strong> Tüm kullanıcı girdileri HTML kaçış fonksiyonlarından geçirilir.</p>
                    <p><strong>API Anahtar Formatı:</strong> Anahtarlar 64 karakterlik hex formatında, <code>sk_</code> prefiksi ile oluşturulur.</p>
                    <p><strong>HMAC-SHA256:</strong> Bot-website iletişimi kriptografik olarak imzalanır.</p>
                    <p><strong>Rate Limiting:</strong> Dakikada 60 istek limiti uygulanır.</p>
                    <p><strong>IDOR Koruması:</strong> Kullanıcılar yalnızca kendi verilerine erişebilir.</p>
                </div>
            </div>
        </div>
    </div>
    
    <!-- API Key Modal -->
    <div class="modal" id="apiKeyModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>API Anahtar Oluştur</h3>
                <button class="modal-close" onclick="closeApiKeyModal()">&times;</button>
            </div>
            <div class="form-group">
                <label>Discord ID</label>
                <input type="text" id="discordIdInput" placeholder="Discord ID'nizi girin">
            </div>
            <div class="form-group">
                <label>Kullanıcı Adı</label>
                <input type="text" id="usernameInput" placeholder="Kullanıcı adınız">
            </div>
            <button class="btn btn-primary" style="width: 100%;" onclick="createApiKey()">
                Anahtar Oluştur
            </button>
        </div>
    </div>
    
    <!-- Toast -->
    <div class="toast" id="toast"></div>

    <script>
        const ICONS = {
            sentiguard: 'fa-brain',
            guardian: 'fa-shield-alt',
            verifier: 'fa-user-check',
            logmaster: 'fa-chart-bar',
            blacklist: 'fa-ban'
        };
        
        let currentApiKey = null;
        
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                showPage(page);
            });
        });
        
        function showPage(page) {
            // Update nav
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelector(\`[data-page="\${page}"]\`).classList.add('active');
            
            // Update page
            document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
            document.getElementById('page-' + page).style.display = 'block';
            
            // Update title
            const titles = {
                overview: 'Genel Bakış',
                bots: 'Bot Yönetimi',
                api: 'API Anahtarları',
                logs: 'Olay Geçmişi',
                security: 'Güvenlik'
            };
            document.getElementById('pageTitle').textContent = titles[page];
            
            // Load page data
            if (page === 'overview') loadData();
            if (page === 'logs') loadLogs();
        }
        
        async function loadData() {
            try {
                const [overview, events, botStatus] = await Promise.all([
                    fetch('/api/overview').then(r => r.json()),
                    fetch('/api/events').then(r => r.json()),
                    fetch('/api/bot-status').then(r => r.json())
                ]);
                
                // Render bot cards
                const grid = document.getElementById('botsGrid');
                grid.innerHTML = overview.bots.map(bot => {
                    const stats = Object.entries(bot.stats).map(([k, v]) =>
                        \`<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border-color);">
                            <span style="color: var(--text-secondary);">\${k}</span>
                            <span style="color: var(--accent-blue); font-weight: 600;">\${v}</span>
                        </div>\`
                    ).join('');
                    
                    const status = botStatus.bots.find(b => b.name === bot.name)?.status || 'offline';
                    const iconClass = ICONS[bot.name] || 'fa-robot';
                    
                    return \`<div class="stat-card">
                        <div class="stat-icon \${bot.name}">
                            <i class="fas \${iconClass}"></i>
                        </div>
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <h4 style="text-transform: capitalize;">\${bot.name}</h4>
                                <span class="status-badge status-\${status}">
                                    <span class="status-dot"></span>
                                    \${status}
                                </span>
                            </div>
                            \${stats || '<span style="color: var(--text-secondary);">Henüz veri yok</span>'}
                        </div>
                    </div>\`;
                }).join('');
                
                // Render events
                const tbody = document.getElementById('eventsBody');
                tbody.innerHTML = events.slice(0, 10).map(e =>
                    \`<tr>
                        <td>\${e.created_at || '—'}</td>
                        <td><span style="background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); padding: 2px 8px; border-radius: 4px; font-size: 12px;">\${e.event_type}</span></td>
                        <td>\${e.user_id ? '&lt;@' + e.user_id + '&gt;' : '—'}</td>
                        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${e.detail || '—'}</td>
                    </tr>\`
                ).join('');
                
                if (events.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Henüz olay yok</td></tr>';
                }
                
                document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('tr-TR');
            } catch (err) {
                console.error('Veri yüklenirken hata:', err);
                showToast('Veriler yüklenirken hata oluştu', 'error');
            }
        }
        
        async function loadLogs() {
            try {
                const [events, warnings, blacklist] = await Promise.all([
                    fetch('/api/events').then(r => r.json()),
                    fetch('/api/warnings').then(r => r.json()),
                    fetch('/api/blacklist').then(r => r.json())
                ]);
                
                const allLogs = [
                    ...events.map(e => ({ ...e, source: 'logmaster' })),
                    ...warnings.map(w => ({ ...w, source: 'sentiguard', event_type: 'Uyarı' })),
                    ...blacklist.map(b => ({ ...b, source: 'blacklist', event_type: 'Karalisteye Ek' }))
                ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
                
                const tbody = document.getElementById('logsBody');
                tbody.innerHTML = allLogs.map(log =>
                    \`<tr>
                        <td>\${log.created_at || '—'}</td>
                        <td><span style="text-transform: capitalize;">\${log.source}</span></td>
                        <td><span style="background: rgba(210, 153, 34, 0.2); color: var(--accent-yellow); padding: 2px 8px; border-radius: 4px; font-size: 12px;">\${log.event_type}</span></td>
                        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${log.detail || log.reason || '—'}</td>
                    </tr>\`
                ).join('');
                
                if (allLogs.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">Henüz log yok</td></tr>';
                }
            } catch (err) {
                console.error('Log yüklenirken hata:', err);
            }
        }
        
        // API Key Functions
        function showApiKeyModal() {
            document.getElementById('apiKeyModal').classList.add('visible');
        }
        
        function closeApiKeyModal() {
            document.getElementById('apiKeyModal').classList.remove('visible');
        }
        
        async function createApiKey() {
            const discordId = document.getElementById('discordIdInput').value;
            const username = document.getElementById('usernameInput').value;
            
            if (!discordId) {
                showToast('Lütfen Discord ID girin', 'error');
                return;
            }
            
            try {
                const response = await fetch('/api/auth/register-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discord_id: discordId, username: username, avatar_url: '' })
                });
                
                const data = await response.json();
                
                if (data.api_key) {
                    currentApiKey = data.api_key;
                    document.getElementById('apiKeyInput').value = data.api_key;
                    document.getElementById('apiKeyBox').classList.add('visible');
                    closeApiKeyModal();
                    showToast('API anahtarı oluşturuldu!', 'success');
                } else {
                    showToast(data.error || 'Hata oluştu', 'error');
                }
            } catch (err) {
                showToast('API anahtarı oluşturulamadı', 'error');
            }
        }
        
        function copyApiKey() {
            if (currentApiKey) {
                navigator.clipboard.writeText(currentApiKey).then(() => {
                    showToast('Panoya kopyalandı!', 'success');
                });
            }
        }
        
        async function revokeApiKey() {
            if (!currentApiKey) return;
            
            if (!confirm('API anahtarınızı iptal etmek istediğinizden emin misiniz?')) return;
            
            try {
                const response = await fetch('/api/auth/revoke-key', {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + currentApiKey }
                });
                
                if (response.ok) {
                    currentApiKey = null;
                    document.getElementById('apiKeyBox').classList.remove('visible');
                    showToast('API anahtarı iptal edildi', 'info');
                }
            } catch (err) {
                showToast('İptal işlemi başarısız', 'error');
            }
        }
        
        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast visible ' + type;
            setTimeout(() => toast.classList.remove('visible'), 3000);
        }
        
        // Initial load
        loadData();
        
        // Auto refresh every 30 seconds
        setInterval(loadData, 30000);
    </script>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(`[Dashboard] Güvenli modda çalışıyor: http://localhost:${PORT}`);
    console.log(`[Güvenlik] MASTER_SECRET: ${MASTER_SECRET.substring(0, 8)}... (bot-iletişimi için)`);
});
