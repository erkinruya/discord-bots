# 🎛️ Hub — Bot Yönetim Merkezi

Hub, tüm moderasyon botlarınızı tek bir Discord botu üzerinden **başlatma, durdurma ve durum izleme** imkanı sunan bir yönetim merkezidir.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Bot Başlatma** | Herhangi bir alt botu Discord'dan başlatır |
| **Bot Durdurma** | Çalışan bir botu güvenle kapatır (SIGINT) |
| **Durum İzleme** | Tüm botların çalışıp çalışmadığını ve uptime bilgisini gösterir |
| **Çoklu Dil Desteği** | Node.js ve Python botlarını otomatik algılar |
| **Sahip Koruması** | Komutlar sadece `OWNER_ID` tarafından kullanılabilir |

## 📦 Kurulum

```bash
cd hub
cp .env.example .env
npm install
node index.js
```

## ⚙️ Komutlar

| Komut | Açıklama |
|---|---|
| `!hub status` | Tüm botların durumunu embed olarak gösterir |
| `!hub start <bot-adı>` | Belirtilen botu başlatır (`bots/` klasöründen) |
| `!hub stop <bot-adı>` | Çalışan botu güvenli şekilde durdurur |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `HUB_TOKEN` | ✅ | Hub botunun kendi Discord token'ı |
| `OWNER_ID` | ✅ | Sadece bu kullanıcı komutları çalıştırabilir |

## ⚠️ Önemli

> Hub botu, **diğer botlardan farklı bir Discord Application** ile çalışmalıdır. Her bot kendi token'ına sahiptir.

## 📐 Mimari

```
hub/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
└── README.md        # Bu dosya
```
