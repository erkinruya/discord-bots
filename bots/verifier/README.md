# 🔐 Verifier — Gelişmiş Giriş Doğrulama

Verifier, yeni üyeleri otomatik karantinaya alan ve gelişmiş doğrulama süreci uygulayan bir giriş kontrol botudur. Hesap yaşı, profil durumu gibi kriterlere göre şüpheli hesapları filtreler.

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| **Otomatik Karantina** | Yeni üyelere karantina rolü atanır, erişim kısıtlanır |
| **Buton Doğrulama** | Kullanıcı butona basarak doğrulama yapar |
| **Şüpheli Hesap Tespiti** | Hesap yaşı ve profil resmi kontrolü |
| **Moderatör Çağrısı** | Şüpheli hesaplar için ek buton: moderatör bilgilendirme |
| **Rol Yönetimi** | Doğrulanan kullanıcının karantina rolü kaldırılır, doğrulanmış rolü eklenir |

## 📦 Kurulum

```bash
cd bots/verifier
cp .env.example .env
npm install
node index.js
```

## 🔧 Ön Hazırlık (Discord Sunucu Tarafı)

1. **Karantina Rolü** oluşturun → Kanallara erişimi kısıtlayın
2. **Doğrulanmış Rolü** oluşturun → Normal erişim verin
3. **Doğrulama kanalı** oluşturun → Sadece karantina rolünün görebildiği bir kanal
4. **Log kanalı** oluşturun → Moderatörlerin göreceği özel kanal

## ⚙️ Komutlar

| Komut | Yetki | Açıklama |
|---|---|---|
| `!verify setup @doğrulanmış @karantina #log #doğrulama` | `Administrator` | Tüm rolleri ve kanalları ayarlar |

## 🔧 Ortam Değişkenleri (`.env`)

| Değişken | Zorunlu | Varsayılan | Açıklama |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | Discord bot token |
| `MIN_ACCOUNT_AGE_DAYS` | ❌ | `7` | Şüpheli hesap eşiği (gün) |
| `LOG_LEVEL` | ❌ | `INFO` | Log seviyesi |

## 🛡️ Şüpheli Hesap Kriterleri

Bir hesap aşağıdaki koşullardan birini sağlıyorsa **şüpheli** olarak işaretlenir:

- Hesap yaşı `MIN_ACCOUNT_AGE_DAYS` gününden küçük
- Profil resmi (avatar) yok

Şüpheli hesaplara ek bir "🚩 Moderatör Çağır" butonu gösterilir.

## 🧩 Uyumluluk

- **Guardian** botu ile birlikte raid tespitini güçlendirir.
- **LogMaster** botu doğrulama olaylarını otomatik loglar.
- **Hub** botu tarafından yönetilebilir.

## 📐 Mimari

```
verifier/
├── index.js         # Ana bot dosyası
├── .env.example     # Örnek ortam değişkenleri
├── package.json     # Bağımsız bağımlılıklar
└── README.md        # Bu dosya
```
