# 🚫 Blacklist — Sunucular Arası Kara Liste

Blacklist, birden fazla sunucu tarafından paylaşılan **merkezi bir kötü kullanıcı veritabanı** sunar. Bir sunucuda işaretlenen kötü niyetli kullanıcılar, diğer sunuculara katıldığında anında tespit edilir.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Ortak Kara Liste** | Tüm sunucular aynı SQLite veritabanını paylaşır |
| **Otomatik Tespit** | Kara listedeki kullanıcı sunucuya girdiğinde anında uyarı |
| **Otomatik Ban (Opsiyonel)** | `AUTO_BAN=true` ayarıyla kara listedeki kullanıcıları otomatik banlar |
| **Kara Liste Yönetimi** | `add`, `remove`, `check`, `list` komutları |
| **Durum Göstergesi** | Botun durumunda kayıtlı kara liste sayısı gösterilir |
| **Detaylı Kayıt** | Kim, ne zaman, hangi sebepten dolayı ekledi bilgisi |

## 📦 Kurulum

```bash
cd bots/blacklist
cp .env.example .env
npm install
node index.js
```

## ⚙️ Komutlar

| Komut | Yetki | Açıklama |
|---|---|---|
| `!bl setup #kanal` | `Administrator` | Log kanalını ayarlar |
| `!bl add @kullanıcı <sebep>` | `Ban Members` | Kullanıcıyı kara listeye ekler |
| `!bl remove @kullanıcı` | `Ban Members` | Kullanıcıyı kara listeden çıkarır |
| `!bl check @kullanıcı` | `Ban Members` | Kullanıcının kara liste durumunu sorgular |
| `!bl check <ID>` | `Ban Members` | ID ile kara liste sorgusu |
| `!bl list` | `Ban Members` | Son 10 kara liste kaydını listeler |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Varsayılan | Açıklama |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Discord bot token |
| `AUTO_BAN` | ❌ | `false` | `true` ise kara listedeki kullanıcı girince otomatik banlar |
| `LOG_LEVEL` | ❌ | `INFO` | Log seviyesi |

## ⚠️ Dikkat

> `AUTO_BAN=true` seçeneği, kara listedeki herhangi bir kullanıcıyı sunucuya girer girmez banlar. Bu ayarı aktive etmeden önce kara listenin güncel ve doğru olduğundan emin olun.

## 🧩 Uyumluluk

- **Guardian** botu nuke girişimi yapan kullanıcıları otomatik olarak Blacklist botuna bildirmek üzere entegre edilebilir.
- **Sentiguard** botu tekrarlayan toksik kullanıcıları kara listeye önerebilir.
- **Hub** botu tarafından yönetilebilir.

## 📐 Mimari

```
blacklist/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
├── package.json     # Bağımsız bağımlılıklar
└── README.md        # Bu dosya
```
