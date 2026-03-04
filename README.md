# 🤖 Discord Moderasyon Botları Koleksiyonu

Modern Discord sunucularının güvenlik ve yönetim ihtiyaçlarını karşılamak üzere tasarlanmış, **bağımsız ama uyumlu** 5 moderasyon botu ve bir yönetim merkezinden oluşan bir koleksiyon.

> ⚡ Her bot kendi başına çalışabilir. İstersen tek birini, istersen hepsini aynı anda kullanabilirsin.

## 📦 Bot Koleksiyonu

| Bot | Prefix | Açıklama | Detay |
|---|---|---|---|
| 🧠 **Sentiguard** | `!sg` | Duygu & toksisite analizi, kanal gerilim takibi | [README →](bots/sentiguard/README.md) |
| 🛡️ **Guardian** | `!guard` | Anti-Nuke & Anti-Raid koruma kalkanı | [README →](bots/guardian/README.md) |
| 🔐 **Verifier** | `!verify` | Gelişmiş giriş doğrulama, şüpheli hesap filtreleme | [README →](bots/verifier/README.md) |
| 📊 **LogMaster** | `!log` | Detaylı olay kaydı & haftalık rapor | [README →](bots/logmaster/README.md) |
| 🚫 **Blacklist** | `!bl` | Sunucular arası kara liste sistemi | [README →](bots/blacklist/README.md) |
| 🎛️ **Hub** | `!hub` | Tüm botları yöneten merkez | [README →](hub/README.md) |

## 🏗️ Proje Yapısı

```
discord-bots/
├── hub/                    # 🎛️ Hub Yönetim Merkezi
│   ├── index.js
│   ├── .env.example
│   └── README.md
├── shared/                 # 🔗 Ortak Altyapı
│   ├── logger.js           # Standart log formatı
│   └── db.js               # SQLite veritabanı yardımcısı
├── bots/
│   ├── sentiguard/         # 🧠 Duygu & Toksisite
│   │   ├── index.js
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── README.md
│   ├── guardian/           # 🛡️ Anti-Nuke
│   │   ├── index.js
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── README.md
│   ├── verifier/           # 🔐 Giriş Doğrulama
│   │   ├── index.js
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── README.md
│   ├── logmaster/          # 📊 Olay Kaydı
│   │   ├── index.js
│   │   ├── package.json
│   │   ├── .env.example
│   │   └── README.md
│   └── blacklist/          # 🚫 Kara Liste
│       ├── index.js
│       ├── package.json
│       ├── .env.example
│       └── README.md
├── data/                   # 📁 Veritabanı dosyaları (gitignore)
├── ROADMAP.md              # 🗺️ Geliştirme yol haritası
├── .gitignore
└── package.json
```

## 🚀 Hızlı Başlangıç

### 1. Depoyu Klonla
```bash
git clone https://github.com/erkinruya/discord-bots.git
cd discord-bots
```

### 2. Bağımlılıkları Kur
```bash
# Kök dizin (Hub için)
npm install

# Tek bir botu kurmak için
cd bots/sentiguard && npm install
```

### 3. Token Ayarla
```bash
# İstediğin botun klasörüne gir
cp bots/sentiguard/.env.example bots/sentiguard/.env
# .env dosyasını aç ve token'ını yapıştır
```

### 4. Botu Çalıştır
```bash
# Doğrudan
cd bots/sentiguard && npm start

# Veya Hub üzerinden (tüm botları Discord'dan yönet)
cd hub && npm start
# Discord'da: !hub start sentiguard
```

## 🧩 Bağımsızlık & Uyumluluk Felsefesi

Bu proje **"independent but compatible"** (bağımsız ama uyumlu) prensibiyle tasarlanmıştır:

- **Bağımsız:** Her bot kendi `package.json`, `.env` ve SQLite veritabanına sahiptir. Herhangi bir botu tek başına çalıştırabilirsiniz.
- **Uyumlu:** Tüm botlar aynı `shared/` altyapısını (logger, db) kullanır. Hub botu tüm botları merkezi olarak yönetebilir. Botlar arası veri paylaşımı (örn. Blacklist ↔ Guardian) mümkündür.

## ⚙️ Gereksinimler

- **Node.js** 18+
- **npm** 9+
- Discord Developer Portal'dan **Bot Token(lar)**
- Aktif **Privileged Gateway Intents** (Message Content, Server Members)

## 📄 Lisans

MIT

---
*Bu proje aktif geliştirme aşamasındadır. Katkıda bulunmak veya öneri paylaşmak için issue açabilirsiniz.*
