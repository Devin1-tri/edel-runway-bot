# 🤖 Edel Runway Desk - Auto Vote Bot

Bot otomatis untuk daily vote pada **Listing Calls** di [Edel Finance Runway Desk](https://runway.edel.finance/listing-calls).

**⚡ Pure HTTP** — tidak butuh Chrome/browser di VPS. Ringan dan cepat.

## ✨ Features

- **Auto Vote** setiap 1 jam (configurable via cron)
- **Pure HTTP** — no Chrome, no Playwright, no browser di VPS
- **Telegram Notifications** — notif realtime setiap vote
- **Smart Voting** — random selection strategy untuk head-to-head calls
- **Session Import** — login di Chrome PC, copy cookie, paste di VPS
- **Retry Logic** — exponential backoff jika gagal
- **VPS Ready** — PM2 support, auto-restart

> ⚠️ **SECURITY**: JANGAN commit file `.env` atau folder `sessions/`!

## 📋 Prerequisites

- **Node.js v18+** → [Download](https://nodejs.org/)
- **Akun Runway Desk** → [Register](https://runway.edel.finance/register)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/AaBatok/Edel.git
cd Edel
npm install
```

> 💡 Hanya 4 dependencies ringan — tidak perlu install Chrome/Playwright!

### 2. Configure

```bash
cp .env.example .env
nano .env
```

### 3. Setup Telegram Bot (Opsional tapi Direkomendasikan)

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot` → ikuti instruksi → dapat **Bot Token**
3. Buka bot kamu, kirim pesan apa saja (misal: "hello")
4. Buka di browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Cari `"chat":{"id": 123456789}` → itu **Chat ID** kamu
6. Masukkan keduanya ke `.env`

### 4. Import Session dari Chrome

```bash
npm run import
```

Cara ambil cookie:

1. **Login** di Chrome PC → buka https://runway.edel.finance
2. Tekan **F12** (DevTools) → klik tab **Network**
3. **Refresh** halaman (Ctrl+R)
4. **Klik** request pertama di daftar
5. Di panel kanan, cari **"Cookie:"** di Request Headers
6. **Klik kanan** value-nya → **Copy value**
7. Di VPS/terminal: `npm run import` → **paste** → Enter

Bot otomatis detect cookie `edel_session` (JWT token yang penting).

### 5. Test & Run

```bash
# Test vote sekali
npm run vote

# Mulai bot scheduler (tiap 1 jam)
npm run start

# Cek status session
npm run status
```

## 🖥️ VPS Deployment (PM2)

### Full Setup (copy-paste)

```bash
# 1. Clone & install
git clone https://github.com/AaBatok/Edel.git
cd Edel
npm install

# 2. Config
cp .env.example .env
nano .env   # isi TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID

# 3. Import session dari Chrome PC
npm run import

# 4. Test
npm run vote

# 5. Start bot dengan PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### PM2 Commands

```bash
pm2 logs edel-vote-bot         # Lihat logs
pm2 restart edel-vote-bot      # Restart
pm2 stop edel-vote-bot         # Stop
pm2 status                     # Status semua
```

## 📨 Telegram Notifications

| Event | Pesan |
|---|---|
| ✅ Vote berhasil | Asset yang dipilih, strategy, waktu |
| ❌ Vote gagal | Error detail, retry info |
| ℹ️ Sudah voted | Status, jadwal berikutnya |
| 🔑 Session expired | Instruksi re-import |
| 🤖 Bot started | Config summary |
| ⏰ Next vote | Estimasi waktu berikutnya |
| 🛑 Bot stopped | Waktu shutdown |

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `VOTE_STRATEGY` | `smart` | `random` / `smart` / `first` / `second` |
| `CRON_SCHEDULE` | `0 */1 * * *` | Cron expression (default: tiap jam) |
| `MAX_RETRIES` | `3` | Jumlah retry jika gagal |
| `SAVE_SCREENSHOTS` | `true` | Log vote evidence |
| `TELEGRAM_BOT_TOKEN` | _(kosong)_ | Token dari @BotFather |
| `TELEGRAM_CHAT_ID` | _(kosong)_ | Chat ID Telegram kamu |

## 📁 Folder Structure

```
Edel/
├── package.json           # 4 deps saja, ringan!
├── .env                   # Config (JANGAN COMMIT!)
├── .env.example           # Config template
├── ecosystem.config.cjs   # PM2 config
├── src/
│   ├── index.js           # CLI entry point
│   ├── api/
│   │   └── client.js      # ⚡ Pure HTTP API client
│   ├── auth/
│   │   └── session.js     # Cookie import/export
│   ├── bot/
│   │   └── voter.js       # Voting logic
│   ├── scheduler/
│   │   └── cron.js        # Cron scheduler + Telegram
│   └── utils/
│       ├── config.js      # Config loader
│       ├── logger.js      # Winston logger
│       └── telegram.js    # Telegram notifications
├── sessions/              # Cookie session (JANGAN COMMIT!)
└── logs/                  # Log files
```

## ⚠️ Troubleshooting

### "SESSION_EXPIRED"
→ Cookie `edel_session` sudah expired.
→ Login ulang di Chrome → F12 → copy cookie → `npm run import`

### "No round available"
→ Belum ada listing call window yang terbuka.
→ Bot akan otomatis coba lagi di jadwal berikutnya.

### Telegram tidak kirim notif
1. Pastikan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` diisi di `.env`
2. Kirim pesan ke bot dulu (bot tidak bisa kirim pesan duluan)
3. Test: `https://api.telegram.org/bot<TOKEN>/getUpdates`

## 📜 Disclaimer

> Bot ini dibuat untuk keperluan edukasi. Penggunaan automasi mungkin melanggar
> Terms & Conditions dari Edel Finance. Gunakan dengan risiko sendiri.
