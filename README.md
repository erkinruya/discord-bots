# 🤖 Discord Moderasyon Botları Koleksiyonu

Modern Discord sunucularının güvenlik ve yönetim ihtiyaçlarını karşılamak üzere tasarlanmış, **bağımsız ama uyumlu** 5 moderasyon botu, bir yönetim merkezi ve web dashboard'undan oluşan ekosistem.

> ⚡ Her bot kendi başına çalışabilir. İstersen tek birini, istersen hepsini aynı anda kullanabilirsin.

## 📦 Bot Koleksiyonu

| Bot | Komutlar | Açıklama | Detay |
|---|---|---|---|
| 🧠 **Sentiguard** | `/sg-*` | AI toksisite analizi, kanal gerilim takibi, Gemini AI | [README →](bots/sentiguard/README.md) |
| 🛡️ **Guardian** | `/guard-*` | Anti-Nuke, karantina modu, kanal yedekleme/geri yükleme | [README →](bots/guardian/README.md) |
| 🔐 **Verifier** | `/verify-*` | CAPTCHA doğrulama, şüpheli hesap filtreleme, raid modu | [README →](bots/verifier/README.md) |
| 📊 **LogMaster** | `/log-*` | Olay kaydı, snipe komutu, haftalık rapor | [README →](bots/logmaster/README.md) |
| 🚫 **Blacklist** | `/bl-*` | Sunucular arası kara liste, JSON export, otomatik ban | [README →](bots/blacklist/README.md) |
| 🎛️ **Hub** | `!hub` | Tüm botları yöneten merkez | [README →](hub/README.md) |

## 🌐 Web Dashboard

Tüm botların verilerini tarayıcıdan canlı izlemek, yönetmek ve güvenliği sağlamak için **GGTPro.Bots Web Dashboard** dahildir.

### Özellikler
- 📊 **Canlı istatistikler** — Tüm botların anlık durumu (30sn auto-refresh)
- 🔐 **Güvenli auth** — Bcrypt şifreleme, CSRF koruması, rate limiting
- 🔑 **Per-bot API token'ları** — Her bot sadece kendi verisine erişebilir
- ⚙️ **Ayarlar paneli** — Şifre değiştirme, token yönetimi, API dökümantasyonu
- 🛡️ **Apache güvenlik** — `.htaccess` ile hassas dosya koruması, XSS/CSRF headers

### İlk Giriş
Site ilk açıldığında otomatik admin hesabı oluşturulur:

| Bilgi | Değer |
|---|---|
| **URL** | `http://localhost/ggtpro/` |
| **Kullanıcı** | `admin` |
| **Şifre** | `ggtpro2026` |

> ⚠️ **İlk girişten sonra Ayarlar sayfasından şifreni mutlaka değiştir!**

### API Güvenlik Modeli

```
┌─────────────────────────────────────────────────┐
│                  Web Dashboard                   │  ← Admin Session (full access)
│        login.php → dashboard.php → settings.php  │
└──────────────────────┬──────────────────────────┘
                       │
              api/bots.php (PHP)
                       │
     ┌─────────────────┼─────────────────┐
     │                 │                 │
  Sentiguard        Guardian         Blacklist      ← Per-bot tokens (scoped)
  Token: abc...     Token: def...    Token: ghi...
  ↓ sadece kendi    ↓ sadece kendi   ↓ sadece kendi
  sentiguard.db     guardian.db      blacklist.db
```

- **Admin token/session** → Tüm botların verisine erişir
- **Bot token** → Sadece kendi veritabanına erişir
- **Cross-bot erişim** → 403 Forbidden ile engellenir

## 🏗️ Proje Yapısı

```
discord-bots/
├── hub/                    # 🎛️ Hub Yönetim Merkezi
│   ├── index.js
│   ├── .env.example
│   └── README.md
├── shared/                 # 🔗 Ortak Altyapı
│   ├── logger.js           # Standart log formatı
│   ├── db.js               # SQLite veritabanı yardımcısı
│   ├── eventbus.js          # Botlar arası IPC (Event Bus)
│   └── commands.js          # Slash Command kayıt helper
├── bots/
│   ├── sentiguard/         # 🧠 AI Toksisite Analizi
│   ├── guardian/           # 🛡️ Anti-Nuke & Karantina
│   ├── verifier/           # 🔐 CAPTCHA Doğrulama
│   ├── logmaster/          # 📊 Olay Kaydı & Snipe
│   └── blacklist/          # 🚫 Kara Liste
├── dashboard/              # 📊 Node.js Dashboard (opsiyonel)
├── data/                   # 📁 SQLite veritabanları (gitignore)
├── .gitignore
└── README.md
```

**Web Dashboard (XAMPP):**
```
C:\xampp\htdocs\ggtpro\
├── index.php               # Landing page
├── login.php               # Güvenli giriş
├── logout.php              # Oturum kapatma
├── dashboard.php           # Canlı dashboard (auth gerekli)
├── settings.php            # Token yönetimi & ayarlar
├── config.php              # Güvenlik & auth modülü
├── icons.php               # Custom SVG ikon kütüphanesi
├── .htaccess               # Apache güvenlik kuralları
├── .gitignore              # Hassas dosyaları hariç tut
├── api/
│   └── bots.php            # REST API (per-bot scoped)
└── assets/
    ├── style.css            # CSS3 dark theme
    └── app.js               # Dashboard frontend
```

## 🚀 Hızlı Başlangıç

### 1. Depoyu Klonla
```bash
git clone https://github.com/erkinruya/discord-bots.git
cd discord-bots
```

### 2. Bağımlılıkları Kur
```bash
# Tek bir botu kurmak için
cd bots/sentiguard && npm install

# Veya tümünü
for dir in bots/*/; do (cd "$dir" && npm install); done
```

### 3. Bot Token'larını Ayarla
```bash
# Her bot için .env dosyası oluştur
cp bots/sentiguard/.env.example bots/sentiguard/.env
# .env dosyasını aç, BOT_TOKEN ve CLIENT_ID'yi yapıştır
```

### 4. Botu Çalıştır
```bash
# Doğrudan
cd bots/sentiguard && npm start

# Veya Hub üzerinden (tüm botları Discord'dan yönet)
cd hub && npm start
# Discord'da: !hub start sentiguard
```

### 5. Web Dashboard (Opsiyonel)
XAMPP üzerinde:
1. Dosyaları `C:\xampp\htdocs\ggtpro\` altına koy
2. Apache'yi başlat
3. Tarayıcıda `http://localhost/ggtpro/` aç
4. `admin` / `ggtpro2026` ile giriş yap
5. **Ayarlar → Şifre Değiştir** ile şifreni güncelle
6. Bot API token'larını botların `.env` dosyalarına ekle

## 🔗 Event Bus — Botlar Arası İletişim

Botlar dosya tabanlı IPC sistemi ile birbirleriyle iletişim kurar:

| Olay | Gönderen | Dinleyen | Tetikleyici |
|---|---|---|---|
| `nuke_detected` | Guardian | LogMaster, Blacklist | Toplu kanal/ban silme |
| `raid_detected` | Guardian | Verifier | Kısa sürede çok üye girişi |
| `toxic_user_alert` | Sentiguard | Blacklist | 10+ uyarı alan kullanıcı |
| `high_tension` | Sentiguard | LogMaster | Kanal gerilimi %80+ |

## 🧩 Bağımsızlık & Uyumluluk Felsefesi

- **Bağımsız:** Her bot kendi `package.json`, `.env` ve SQLite veritabanına sahiptir
- **Uyumlu:** Tüm botlar `shared/` altyapısını kullanır; Event Bus ile otomatik iletişim
- **Güvenli:** Web dashboard per-bot scoped API token'ları ile cross-bot erişimi engeller

## ⚙️ Gereksinimler

| Bileşen | Versiyon |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| XAMPP (Dashboard için) | 8+ (PHP 8.1+, SQLite3) |
| Discord Bot Token | [Developer Portal](https://discord.com/developers/applications) |
| Privileged Intents | Message Content, Server Members |

## 📄 Lisans

MIT

---
*Bu proje aktif geliştirme aşamasındadır. Katkıda bulunmak veya öneri paylaşmak için issue açabilirsiniz.*
