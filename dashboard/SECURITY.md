# Discord Bots Dashboard - Güvenlik ve Geliştirme Kılavuzu

## 📋 Genel Bakış

Bu proje, Discord moderasyon botları için güvenli bir web yönetim paneli içerir. XAMPP üzerinde çalışan PHP yerine Node.js tabanlı modern bir mimari kullanılmaktadır.

---

## 🔒 Güvenlik Özellikleri

### 1. XSS (Cross-Site Scripting) Koruması
- Tüm kullanıcı verileri `escapeHtml()` fonksiyonundan geçirilir
- HTML meta karakterleri otomatik olarak dönüştürülür
- Veritabanından gelen veriler前端'de güvenli şekilde gösterilir

### 2. SQL Injection Koruması
- Prepared statements kullanılır
- Parametreli sorgular ile veritabanı işlemleri gerçekleştirilir

### 3. IDOR (Insecure Direct Object Reference) Koruması
- Kullanıcılar yalnızca kendi verilerine erişebilir
- Session-based yetkilendirme kontrolü yapılır

### 4. API Key Sistemi (CSPRNG)
- **Format:** `sk_` + 64 karakter hexadecimal
- **Üretim:** `crypto.randomBytes(32)` ile kriptografik güvenli rastgele sayı üreteci
- Anahtarlar veritabanında saklanır (gerçek uygulamada hash'lenmelidir)

### 5. HMAC-SHA256 İmzalama (Bot-Websitesi İletişimi)
```
Bot → Website: 
- Payload + Timestamp imzalanır
- HMAC-SHA256(secret, payload) → Signature
- Header'da gönderilir

Website:
- Signature doğrulanır
- timingSafeEqual ile timing attack önlenir
- Geçersiz imzalar reddedilir
```

### 6. Rate Limiting
- Dakikada 60 istek limiti
- IP bazlı takip
- Aşım durumunda 429 HTTP kodu

---

## 🚀 Kurulum

### 1. Bağımlılıkları Yükle
```bash
cd dashboard
npm install
```

### 2. Ortam Değişkenlerini Ayarla
`.env` dosyası oluştur (veya .env.example'dan kopyala):

```env
# Port ayarı
DASHBOARD_PORT=3000

# GÜVENLIK: Bot-website iletişimi için paylaşılan gizli anahtar
# ÖNEMLİ: Bu anahtar hem dashboard'da hem de botlarda aynı olmalı!
MASTER_SECRET=guvenli_bir_anahtar_buraya
```

### 3. Dashboard'ı Başlat
```bash
npm start
# veya geliştirme modunda
npm run dev
```

---

## 📡 API Endpoints

### Herkese Açık
| Endpoint | Açıklama |
|----------|----------|
| `GET /` | Dashboard HTML |
| `GET /api/public/stats` | Genel istatistikler |
| `GET /api/overview` | Bot istatistikleri |
| `GET /api/events` | Son olaylar |
| `GET /api/warnings` | Uyarılar |
| `GET /api/blacklist` | Kara liste |
| `GET /api/bot-status` | Bot durumları |

### Korumalı (API Key Gerekli)
| Endpoint | Açıklama |
|----------|----------|
| `GET /api/secure/overview` | Detaylı bot istatistikleri |
| `GET /api/secure/user/data` | Kullanıcı verileri |
| `GET /api/bot/status/:name` | Belirli bot durumu |

### Bot-Websitesi İletişimi
| Endpoint | Açıklama |
|----------|----------|
| `POST /api/bot/webhook` | Botlardan veri alış (HMAC imzalı) |

### Kimlik Doğrulama
| Endpoint | Açıklama |
|----------|----------|
| `POST /api/auth/register-key` | Yeni API anahtarı oluştur |
| `DELETE /api/auth/revoke-key` | API anahtarını iptal et |

---

## 🔧 Bot Entegrasyonu

### Sentiguard Botu Örneği

1. Botun `.env` dosyasına ekle:
```env
DASHBOARD_URL=http://localhost:3000
MASTER_SECRET=guvenli_bir_anahtar_buraya  # Dashboard ile aynı!
```

2. Bot kodunda kullanım:
```javascript
const { SecureDashboardClient } = require('../../shared/secure-client');

const dashboard = new SecureDashboardClient({
    botName: 'sentiguard',
    dashboardUrl: process.env.DASHBOARD_URL,
    secret: process.env.MASTER_SECRET
});

// Olay bildirimi
await dashboard.reportEvent('warning', {
    user_id: '123456789',
    reason: 'Toksik içerik'
});

// Durum raporu
await dashboard.reportStatus({ status: 'online' });
```

---

## 🎨 Dashboard Özellikleri

### Yeni UI:
- **Sidebar Navigasyonu:** Kolay sayfa geçişi
- **Bot Durum Kartları:** Gerçek zamanlı durum gösterimi
- **API Anahtar Yönetimi:** Oluştur, kopyala, iptal et
- **Olay Geçmişi:** Tüm bot olayları tek sayfada
- **Güvenlik Sayfası:** Sistem bilgileri

### Sayfalar:
1. **Genel Bakış:** Bot istatistikleri ve son olaylar
2. **Bot Yönetimi:** Tüm botların durumu
3. **API Anahtarları:** Kişisel API anahtarı oluşturma
4. **Olay Geçmişi:** Detaylı log kayıtları
5. **Güvenlik:** Sistem güvenlik bilgileri

---

## ⚠️ Güvenlik Önlemleri

### Üretim Ortamı İçin:

1. **HTTPS kullanın** - HTTP yerine
2. **Session güvenliği** - HttpOnly, Secure cookies
3. **Rate limiting** - Geliştirilmiş limitler
4. **API key hash** - bcrypt/argon2 ile hash'leme
5. **Input validation** - Tüm girdileri doğrulayın
6. **CORS** - Sadece izin verilen domain'ler

### Örnek Nginx Konfigürasyonu:
```nginx
server {
    listen 443 ssl;
    server_name botlar.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📁 Proje Yapısı

```
discord-bots/
├── dashboard/          # Web dashboard
│   ├── index.js       # Ana server dosyası
│   ├── .env.example   # Örnek konfigürasyon
│   └── package.json
├── bots/              # Discord botları
│   ├── sentiguard/    # AI duygu analizi
│   ├── guardian/      # Nuke koruma
│   ├── logmaster/     # Event logging
│   ├── verifier/      # Doğrulama
│   └── blacklist/     # Kara liste
├── shared/            # Paylaşılan modüller
│   ├── db.js          # Veritabanı
│   ├── logger.js      # Logging
│   ├── eventbus.js    # Botlar arası iletişim
│   ├── commands.js    # Slash commands
│   └── secure-client.js # Güvenli iletişim
└── hub/               # Bot yönetim hub'ı
```

---

## 🔍 Test Senaryoları

### Güvenlik Testleri:

1. **XSS Testi:**
   - Event detail alanına `<script>alert('xss')</script>` yaz
   - Beklenen: Script çalışmaz, metin olarak gösterilir

2. **IDOR Testi:**
   - Bir kullanıcı olarak giriş yap
   - Başka kullanıcının ID'si ile veri iste
   - Beklenen: 403 Forbidden

3. **Rate Limit Testi:**
   - 60'tan fazla istek gönder
   - Beklenen: 429 Too Many Requests

4. **HMAC Testi:**
   - Bot olmadan webhook'a istek at
   - Beklenen: 401 Unauthorized

---

## 📞 Destek

Sorunlar veya sorular için GitHub Issues kullanabilirsiniz.

---

## Lisans

MIT License
