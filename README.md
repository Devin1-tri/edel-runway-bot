# 🤖 Edel Runway Desk - Auto Vote Bot

Bot otomatis untuk daily vote pada **Listing Calls** di [Edel Finance Runway Desk](https://runway.edel.finance/listing-calls).

## ✨ Features

- **Auto Vote** setiap 1 jam (configurable via cron)
- **Smart Voting** - analisa data vote untuk pilih asset terbaik (momentum strategy)
- **Session Persistence** - login manual 1x, session disimpan untuk reuse
- **Retry Logic** - exponential backoff jika gagal
- **Screenshot** - bukti setiap vote tersimpan
- **VPS Ready** - jalan headless + PM2 support

## 📋 Prerequisites

### Local (PC)
- **Node.js v18+** → [Download](https://nodejs.org/)
- **Akun Runway Desk** → [Register](https://runway.edel.finance/register)
- **Passkey** sudah di-setup (Windows Hello / fingerprint / security key)

### VPS (Linux)
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright system dependencies
npx playwright install-deps chromium

# Install PM2 globally
npm install -g pm2
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd edel-bot
npm install
npx playwright install chromium
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env sesuai kebutuhan
```

### 3. Login Setup (1x saja)

```bash
npm run setup
```

> ⚠️ **PENTING**: Ini akan membuka browser. Login dengan passkey kamu.
> Session akan disimpan otomatis. Hanya perlu 1x (atau saat session expired).
>
> **Untuk VPS**: Jalankan setup di PC lokal dulu (karena butuh GUI untuk passkey),
> lalu copy folder `sessions/` ke VPS.

### 4. Run Bot

```bash
# Vote sekali (test)
npm run vote

# Mulai bot scheduler (setiap 1 jam)
npm run start

# Cek status
node src/index.js status
```

## 🖥️ VPS Deployment (PM2)

### Transfer Session dari PC ke VPS

```bash
# Di PC lokal, setelah npm run setup:
scp -r ./sessions/ user@your-vps:/path/to/edel-bot/sessions/
```

### Start dengan PM2

```bash
# Start bot
pm2 start ecosystem.config.cjs

# Monitor logs
pm2 logs edel-vote-bot

# Status
pm2 status

# Auto-start on reboot
pm2 startup
pm2 save
```

### PM2 Commands

```bash
pm2 restart edel-vote-bot    # Restart bot
pm2 stop edel-vote-bot       # Stop bot
pm2 delete edel-vote-bot     # Remove from PM2
pm2 logs edel-vote-bot --lines 50  # Lihat 50 log terakhir
```

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `VOTE_STRATEGY` | `smart` | `random` / `smart` / `first` / `second` |
| `CRON_SCHEDULE` | `0 */1 * * *` | Cron expression (default: tiap jam) |
| `HEADLESS` | `true` | `true` untuk VPS, `false` untuk debug |
| `SLOW_MO` | `500` | Delay antar aksi (ms), makin tinggi makin mirip manusia |
| `PAGE_TIMEOUT` | `30000` | Timeout tunggu halaman (ms) |
| `MAX_RETRIES` | `3` | Jumlah retry jika gagal |
| `SAVE_SCREENSHOTS` | `true` | Simpan screenshot tiap vote |

## 🎯 Voting Strategies

| Strategy | Deskripsi |
|---|---|
| `random` | Pilih acak dari pilihan yang tersedia |
| `smart` | Analisa vote counts, pilih yang paling populer (momentum) |
| `first` | Selalu pilih opsi pertama (kiri) |
| `second` | Selalu pilih opsi kedua (kanan) |

## 📁 Folder Structure

```
edel-bot/
├── package.json           # Dependencies & scripts
├── .env                   # Configuration (copy from .env.example)
├── .env.example           # Config template
├── ecosystem.config.cjs   # PM2 deployment config
├── src/
│   ├── index.js           # CLI entry point
│   ├── auth/
│   │   ├── login.js       # Passkey login + browser launch
│   │   └── session.js     # Session save/load/validate
│   ├── bot/
│   │   └── voter.js       # Core voting logic + smart strategy
│   ├── scheduler/
│   │   └── cron.js        # Cron scheduling + retry
│   └── utils/
│       ├── config.js      # Config loader
│       └── logger.js      # Winston logger
├── sessions/              # Saved browser sessions (gitignored)
├── screenshots/           # Vote evidence screenshots (gitignored)
└── logs/                  # Log files (gitignored)
```

## ⚠️ Troubleshooting

### "Session expired"
→ Jalankan `npm run setup` ulang untuk login lagi.

### "No voting options found"
→ Mungkin belum ada active listing call, atau UI berubah.
→ Cek screenshot di folder `screenshots/` untuk debug.
→ Jalankan dengan `HEADLESS=false` untuk lihat browser.

### Browser crash di VPS
```bash
# Install Playwright system deps
npx playwright install-deps chromium

# Atau install secara manual
sudo apt-get install -y libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0
```

### Session transfer ke VPS
1. Login di PC lokal: `npm run setup` (butuh GUI)
2. Copy session: `scp -r ./sessions/ user@vps:/app/sessions/`
3. Di VPS: `pm2 start ecosystem.config.cjs`

## 📜 Disclaimer

> Bot ini dibuat untuk keperluan edukasi. Penggunaan automasi mungkin melanggar
> Terms & Conditions dari Edel Finance. Gunakan dengan risiko sendiri.
> Developer tidak bertanggung jawab atas konsekuensi penggunaan bot ini.
