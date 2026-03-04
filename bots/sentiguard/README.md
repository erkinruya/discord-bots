# 🧠 Sentiguard — AI Duygu & Toksisite Analizi

Sentiguard, Discord sunucularındaki sohbet gerilimini gerçek zamanlı izleyen ve moderatörlere **erken uyarı** gönderen bir moderasyon botudur.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Toksisite Skoru** | Her mesajı analiz eder ve kelime/kalıp tabanlı bir toksisite puanı hesaplar |
| **Kanal Gerilim Takibi** | Her kanalın birikimli gerilim skorunu izler, zamanla düşer |
| **Moderatör Uyarısı** | Eşik aşıldığında log kanalına otomatik embed uyarı gönderir |
| **Uyarı Geçmişi** | Kullanıcı bazlı uyarı kayıtlarını SQLite'ta tutar |
| **Otomatik Skor Çürümesi** | Gerilim skoru 2 dakika içinde otomatik düşer (false alarm engeli) |

## 📦 Kurulum

```bash
cd bots/sentiguard
cp .env.example .env      # Token'ını düzenle
npm install               # Bağımsız bağımlılıkları kur
node index.js             # Botu başlat
```

## ⚙️ Komutlar

| Komut | Yetki | Açıklama |
|---|---|---|
| `!sg setup #kanal [eşik]` | `Manage Guild` | Log kanalını ve gerilim eşiğini ayarlar |
| `!sg warnings @kullanici` | `Manage Guild` | Kullanıcının uyarı geçmişini gösterir |
| `!sg tension` | `Manage Guild` | Mevcut kanalın gerilim skorunu gösterir |
| `!sg stats` | `Manage Guild` | Sunucu geneli toksisite istatistiklerini gösterir |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `LOG_LEVEL` | ❌ | Log seviyesi: `DEBUG`, `INFO`, `WARN`, `ERROR` (varsayılan: `INFO`) |

## 🧩 Uyumluluk

- **LogMaster** ile birlikte çalışarak toksisite olaylarını merkezi loglara aktarabilir.
- **Blacklist** botu ile entegre edildiğinde, yüksek toksisite gösteren kullanıcılar otomatik olarak kara listeye önerilebilir.
- **Hub** botu tarafından `!hub start sentiguard` ile uzaktan başlatılabilir.

## 📐 Mimari

```
sentiguard/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
├── package.json     # Bağımsız bağımlılıklar
└── README.md        # Bu dosya
```
