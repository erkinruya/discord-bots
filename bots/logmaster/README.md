# 📊 LogMaster — Detaylı Olay Kaydı & Haftalık Rapor

LogMaster, sunucunuzda gerçekleşen tüm önemli olayları detaylı bir şekilde loglayan ve her hafta otomatik rapor oluşturan bir analiz botudur.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Mesaj Takibi** | Silinen ve düzenlenen mesajları loglar (eski/yeni içerik) |
| **Üye Takibi** | Katılan ve ayrılan üyeleri ve hesap yaşlarını kaydeder |
| **Ses Kanalı İzleme** | Giriş, çıkış ve kanal değişikliklerini takip eder |
| **SQLite Veritabanı** | Tüm olayları kalıcı olarak kaydeder |
| **Haftalık Rapor** | Her Pazar 20:00'de otomatik sunucu sağlık raporu gönderir |
| **Olay Özeti** | Haftalık olay türlerinin istatistiksel dağılımı |
| **En Aktif Kullanıcılar** | Haftalık en çok olay oluşturan kullanıcılar listesi |

## 📦 Kurulum

```bash
cd bots/logmaster
cp .env.example .env
npm install
node index.js
```

## ⚙️ Komutlar

| Komut | Yetki | Açıklama |
|---|---|---|
| `!log setup #kanal` | `Administrator` | Log kanalını ayarlar |
| `!log report` | `Administrator` | Manuel olarak haftalık raporu tetikler |
| `!log stats` | `Administrator` | Son 24 saatin olay özetini gösterir |

## 📋 Loglanan Olaylar

| Olay | Simge | Detay |
|---|---|---|
| Mesaj Silme | 🗑️ | Kullanıcı, kanal, silinen içerik |
| Mesaj Düzenleme | ✏️ | Eski ve yeni içerik karşılaştırması |
| Üye Katılma | 📥 | Kullanıcı adı, hesap yaşı |
| Üye Ayrılma | 📤 | Kullanıcı adı |
| Ses Kanalı Giriş | 🔊 | Kullanıcı, kanal adı |
| Ses Kanalı Çıkış | 🔊 | Kullanıcı, kanal adı |
| Ses Kanalı Değişiklik | 🔊 | Eski kanal → Yeni kanal |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `LOG_LEVEL` | ❌ | Log seviyesi (varsayılan: `INFO`) |

## 🧩 Uyumluluk

- **Sentiguard** toksisite uyarılarını LogMaster'a yönlendirebilir.
- **Guardian** nuke/raid olaylarını LogMaster üzerinden kalıcı kayıt altına alabilir.
- **Hub** botu tarafından yönetilebilir.

## 📐 Mimari

```
logmaster/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
├── package.json     # Bağımsız bağımlılıklar
└── README.md        # Bu dosya
```
