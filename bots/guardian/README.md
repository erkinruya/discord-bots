# 🛡️ Guardian — Anti-Nuke & Anti-Raid Kalkanı

Guardian, sunucu yetkililerinin hesapları ele geçirilse bile sunucunuzu koruyan bir **güvenlik kalkanı** botudur. Kısa sürede gerçekleşen tehlikeli işlemleri anında tespit eder ve müdahale eder.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Anti-Nuke** | Kısa sürede çoklu kanal silme, toplu ban gibi işlemleri algılar |
| **Otomatik De-Role** | Tespit edilen saldırganın tüm rollerini anında alır |
| **Anti-Raid** | 10 saniye içinde 8+ yeni üye girişinde raid uyarısı verir |
| **Audit Log Takibi** | Discord Audit Log'larını okuyarak sorumlu kişiyi belirler |
| **Yapılandırılabilir Eşikler** | Kanal silme, ban, kick işlemleri için ayrı limitler |

## 📦 Kurulum

```bash
cd bots/guardian
cp .env.example .env
npm install
node index.js
```

## ⚙️ Komutlar

| Komut | Yetki | Açıklama |
|---|---|---|
| `!guard setup #kanal` | `Administrator` | Log kanalını ayarlar ve korumayı aktive eder |
| `!guard thresholds` | `Administrator` | Mevcut eşik değerlerini gösterir |
| `!guard whitelist @kullanıcı` | `Administrator` | Kullanıcıyı korumadan muaf tutar |

## 🔒 Koruma Eşikleri (Varsayılan)

| İşlem | Limit | Süre |
|---|---|---|
| Kanal Silme | 3 | 10 saniye |
| Kanal Oluşturma | 5 | 10 saniye |
| Toplu Ban | 3 | 10 saniye |
| Toplu Kick | 5 | 15 saniye |
| Raid (Üye Girişi) | 8 | 10 saniye |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `LOG_LEVEL` | ❌ | Log seviyesi (varsayılan: `INFO`) |

## 🧩 Uyumluluk

- **LogMaster** ile birlikte çalışarak tüm nuke/raid olaylarını kalıcı olarak kaydedebilir.
- **Blacklist** botu ile entegre: Nuke girişimi yapan kullanıcılar otomatik kara listeye eklenebilir.
- **Hub** botu tarafından yönetilebilir.

## ⚠️ Önemli Not

> Guardian botunun Audit Log'ları okuyabilmesi için `View Audit Log` iznine sahip olması **zorunludur**. Ayrıca botun rolü, izlemek istediğiniz yetkililerden **üstte** olmalıdır.

## 📐 Mimari

```
guardian/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
├── package.json     # Bağımsız bağımlılıklar
└── README.md        # Bu dosya
```
