/**
 * Web Dashboard - Tüm botların durumunu web üzerinden izle
 * Express.js + basit HTML frontend
 * Port: 3000 (varsayılan)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BOTS_DIR = path.join(__dirname, '..', 'bots');

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
        if (db) db.close();
        return { name: botName, stats };
    });
    res.json({ bots: overview, timestamp: new Date().toISOString() });
});

// API: Blacklist entries
app.get('/api/blacklist', (req, res) => {
    const db = getDb('blacklist');
    if (!db) return res.json([]);
    const entries = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    res.json(entries);
});

// API: Recent events
app.get('/api/events', (req, res) => {
    const db = getDb('logmaster');
    if (!db) return res.json([]);
    const events = db.prepare('SELECT * FROM event_log ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    res.json(events);
});

// API: Sentiguard warnings
app.get('/api/warnings', (req, res) => {
    const db = getDb('sentiguard');
    if (!db) return res.json([]);
    const warnings = db.prepare('SELECT * FROM warnings ORDER BY created_at DESC LIMIT 50').all();
    db.close();
    res.json(warnings);
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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #161b22 0%, #1a1f2e 100%);
            border-bottom: 1px solid #30363d;
            padding: 20px 40px;
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .header h1 { color: #58a6ff; font-size: 24px; }
        .header .subtitle { color: #8b949e; font-size: 14px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 30px 40px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 24px;
            transition: border-color 0.2s, transform 0.2s;
        }
        .card:hover { border-color: #58a6ff; transform: translateY(-2px); }
        .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
        .card-header .icon { font-size: 28px; }
        .card-header h2 { font-size: 18px; color: #f0f6fc; }
        .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #21262d; }
        .stat:last-child { border: none; }
        .stat .label { color: #8b949e; }
        .stat .value { color: #58a6ff; font-weight: 600; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
        .badge-green { background: #0d4429; color: #3fb950; }
        .badge-red { background: #490202; color: #f85149; }
        .badge-yellow { background: #3d2e00; color: #d29922; }
        .section-title { font-size: 20px; color: #f0f6fc; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #21262d; }
        .table { width: 100%; border-collapse: collapse; }
        .table th { text-align: left; padding: 12px; background: #161b22; color: #8b949e; border-bottom: 2px solid #30363d; }
        .table td { padding: 10px 12px; border-bottom: 1px solid #21262d; }
        .table tr:hover { background: #1c2128; }
        .refresh-btn {
            background: #238636; color: #fff; border: none; padding: 8px 16px;
            border-radius: 6px; cursor: pointer; font-size: 14px; transition: background 0.2s;
        }
        .refresh-btn:hover { background: #2ea043; }
        .auto-refresh { color: #8b949e; font-size: 12px; margin-left: 12px; }
        #lastUpdate { color: #58a6ff; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🤖 Discord Bots Dashboard</h1>
            <div class="subtitle">Moderasyon Bot Koleksiyonu — Yönetim Paneli</div>
        </div>
        <div style="margin-left: auto;">
            <button class="refresh-btn" onclick="loadData()">🔄 Yenile</button>
            <span class="auto-refresh">Son: <span id="lastUpdate">—</span></span>
        </div>
    </div>
    <div class="container">
        <h3 class="section-title">📊 Bot Durumları</h3>
        <div class="grid" id="botsGrid"></div>

        <h3 class="section-title">📋 Son Olaylar</h3>
        <div class="card" style="overflow-x: auto;">
            <table class="table">
                <thead><tr><th>Zaman</th><th>Tür</th><th>Kullanıcı</th><th>Detay</th></tr></thead>
                <tbody id="eventsBody"></tbody>
            </table>
        </div>
    </div>

    <script>
        const ICONS = { sentiguard: '🧠', guardian: '🛡️', verifier: '🔐', logmaster: '📊', blacklist: '🚫' };
        const COLORS = { sentiguard: '#6666ff', guardian: '#0099ff', verifier: '#00bfff', logmaster: '#9b59b6', blacklist: '#cc0000' };

        async function loadData() {
            try {
                const [overview, events] = await Promise.all([
                    fetch('/api/overview').then(r => r.json()),
                    fetch('/api/events').then(r => r.json()),
                ]);

                // Render bot cards
                const grid = document.getElementById('botsGrid');
                grid.innerHTML = overview.bots.map(bot => {
                    const stats = Object.entries(bot.stats).map(([k, v]) =>
                        '<div class="stat"><span class="label">' + k + '</span><span class="value">' + v + '</span></div>'
                    ).join('');
                    return '<div class="card"><div class="card-header"><span class="icon">' + (ICONS[bot.name] || '🤖') + '</span><h2>' + bot.name.charAt(0).toUpperCase() + bot.name.slice(1) + '</h2></div>' + (stats || '<div class="stat"><span class="label">Henüz veri yok</span></div>') + '</div>';
                }).join('');

                // Render events
                const tbody = document.getElementById('eventsBody');
                tbody.innerHTML = events.slice(0, 20).map(e =>
                    '<tr><td>' + (e.created_at || '—') + '</td><td><span class="badge badge-yellow">' + e.event_type + '</span></td><td>' + (e.user_id ? '&lt;@' + e.user_id + '&gt;' : '—') + '</td><td>' + (e.detail?.slice(0, 80) || '—') + '</td></tr>'
                ).join('');

                document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('tr-TR');
            } catch (err) {
                console.error('Failed to load data:', err);
            }
        }

        loadData();
        setInterval(loadData, 30000); // Auto-refresh every 30s
    </script>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(\`[Dashboard] Running at http://localhost:\${PORT}\`);
});
