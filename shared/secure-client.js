/**
 * Shared Security Module - Bot-Website Güvenli İletişim
 * 
 * Bu modül, botların website ile güvenli bir şekilde 
 * iletişim kurmasını sağlar (HMAC-SHA256 imzalama).
 * 
 * Kullanım:
 *   const secureClient = require('./shared/secure-client')('sentiguard');
 *   
 *   // Website'ye veri gönder
 *   await secureClient.sendToDashboard({ event: 'warning', data: {...} });
 */

const crypto = require('crypto');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const DEFAULT_DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';
const DEFAULT_BOT_NAME = 'unknown';

function getBotName() {
    // Botun klasör adını otomatik algıla
    const cwd = process.cwd();
    const botsDir = path.join(__dirname, '..', 'bots');
    
    // Mevcut dizin bots klasörünün altında mı?
    if (cwd.startsWith(botsDir)) {
        const relative = path.relative(botsDir, cwd);
        const parts = relative.split(path.sep);
        if (parts.length > 0) {
            return parts[0];
        }
    }
    
    // Ortam değişkeninden al
    return process.env.BOT_NAME || DEFAULT_BOT_NAME;
}

class SecureDashboardClient {
    constructor(options = {}) {
        this.botName = options.botName || getBotName();
        this.dashboardUrl = options.dashboardUrl || DEFAULT_DASHBOARD_URL;
        this.masterSecret = options.secret || process.env.MASTER_SECRET;
        this.enabled = !!this.masterSecret;
        
        if (!this.enabled) {
            console.warn(`[GÜVENLIK] ${this.botName}: MASTER_SECRET ayarlanmamış! İletişim güvensiz modda.`);
        }
    }
    
    /**
     * HMAC-SHA256 imza oluştur
     */
    createSignature(payload) {
        if (!this.masterSecret) {
            return null;
        }
        return crypto.createHmac('sha256', this.masterSecret)
            .update(JSON.stringify(payload))
            .digest('hex');
    }
    
    /**
     * Dashboard'a güvenli istek gönder
     */
    async sendToDashboard(endpoint, data) {
        const payload = {
            ...data,
            bot_name: this.botName,
            timestamp: Date.now()
        };
        
        const signature = this.createSignature(payload);
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                payload,
                signature,
                bot_name: this.botName
            })
        };
        
        try {
            const response = await fetch(`${this.dashboardUrl}${endpoint}`, options);
            const result = await response.json();
            
            if (!response.ok) {
                console.error(`[HATA] ${this.botName}: Dashboard isteği başarısız -`, result.error);
                return { success: false, error: result.error };
            }
            
            return { success: true, data: result };
        } catch (error) {
            console.error(`[HATA] ${this.botName}: Dashboard bağlantı hatası -`, error.message);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Bot durumunu dashboard'a bildir
     */
    async reportStatus(status) {
        return this.sendToDashboard('/api/bot/webhook', {
            type: 'status_report',
            status
        });
    }
    
    /**
     * Olay bildirimi gönder
     */
    async reportEvent(eventType, eventData) {
        return this.sendToDashboard('/api/bot/webhook', {
            type: 'event',
            event_type: eventType,
            ...eventData
        });
    }
    
    /**
     * İstatistik gönder
     */
    async reportStats(stats) {
        return this.sendToDashboard('/api/bot/webhook', {
            type: 'stats',
            stats
        });
    }
    
    /**
     * Dashboard'tan veri iste (güvenli)
     */
    async requestFromDashboard(endpoint, apiKey) {
        const response = await fetch(`${this.dashboardUrl}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        return response.json();
    }
}

/**
 * API Key doğrulama fonksiyonu
 */
function validateApiKeyFormat(key) {
    return /^sk_[a-f0-9]{64}$/.test(key);
}

/**
 * Güvenli rastgele anahtar üretimi
 */
function generateSecureKey(prefix = 'sk_') {
    return prefix + crypto.randomBytes(32).toString('hex');
}

module.exports = {
    SecureDashboardClient,
    validateApiKeyFormat,
    generateSecureKey
};
