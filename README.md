# 🤖 Edel Runway Desk - Auto Vote Bot

Automated daily voting bot for **Listing Calls** on [Edel Finance Runway Desk](https://runway.edel.finance/listing-calls).

Fork of [AaBatok/Edel](https://github.com/AaBatok/Edel) with multi-account, smart scheduling, and voting strategies.

## ✨ Features

- **Multi-Account** — run multiple accounts sequentially (no collision, no missed rounds)
- **Smart Scheduling** — syncs with round window + random +5-9 min buffer
- **9 Voting Strategies** — demand, marketcap, popular, underdog, pick-TICKER, and more
- **Consolidated Notifications** — one Telegram report per vote cycle (not per account)
- **Session Import** — interactive multi-account import via CLI or Telegram
- **Retry Logic** — auto retry with exponential backoff per account
- **VPS Ready** — runs in `screen`, auto-restart on failure

## 📋 Prerequisites

- **Node.js v18+** → [Download](https://nodejs.org/)
- **Runway Desk account(s)** → [Register](https://runway.edel.finance/register)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Devin1-tri/edel-runway-bot.git
cd edel-runway-bot
npm install
```

### 2. Configure Accounts

Edit `accounts.txt` — add your accounts (one per line):

```
A1
A2
A3
```

Lines starting with `#` are ignored. Uncomment to enable.

### 3. Import Sessions

```bash
npm run import
```

This will prompt you to paste cookies for each account:

```
🔐 Import session for 3 account(s)

📋 Paste cookie for A1:
   > edel_session=eyJ...
   ✅ A1 saved (3 cookies)

📋 Paste cookie for A2:
   > edel_session=eyJ...
   ✅ A2 saved (3 cookies)

📋 Paste cookie for A3:
   > edel_session=eyJ...
   ✅ A3 saved (3 cookies)

✅ Done! 3/3 accounts imported.
```

### 4. Run

```bash
# Test single vote
npm run vote

# Start auto-vote bot
npm run start
```

### 5. Run in Screen

```bash
screen -S edel
npm run start
# Press Ctrl+A then D to detach
```

---

## 👥 Multi-Account Management

### Check Accounts

```bash
npm run accounts
```

Output:
```
👥 Accounts (3):

  ✅ 📦 A1   │ last: voted
  ✅ 📦 A2   │ last: already_voted
  ⏸️ ❌ A3   │ last: never
```

### Enable/Disable Accounts

```bash
node src/index.js disable A2    # Skip A2 in vote cycle
node src/index.js enable A2     # Re-enable
```

### Add/Remove Accounts

1. Edit `accounts.txt` — add/remove lines
2. Run `npm run import` to set up cookies for new accounts

### Vote Flow

```
Round opens → +5-9 min (random buffer)
→ A1 votes → 1 min delay
→ A2 votes → 1 min delay
→ A3 votes
→ Send consolidated report to Telegram
→ Sync with next round window
```

**Total time:** ~10-14 min for 3 accounts, ~14-18 min for 5 accounts.

### Auto-Migration

If you have an existing `sessions/state.json` from single-account mode, the bot automatically migrates it to `A1` on first run.

---

## 📱 Telegram Cookie Refresh

When a session expires, paste new cookie in Telegram:

```
A1: edel_session=eyJ...
```

- Prefix with account ID (`A1:`, `A2:`, etc.)
- Without prefix → defaults to `A1`
- Cookie message is auto-deleted for security

---

## 📨 Telegram Notifications

One consolidated report per vote cycle:

**All success:**
```
✅ VOTE CYCLE COMPLETE (3/3)

👤 A1: NVDA, AAPL, META, AMZN, MSFT, TSLA, GOOGL
👤 A2: NVDA, PLTR, V, AMZN, JPM, MA, GS
👤 A3: META, AAPL, NVDA, AMZN, GOOGL, MSFT, NFLX

🎯 Strategy: demand
🕐 Time: 3/7/2026, 15.09.00
⏰ Next: 17.05.00
```

**Partial failure:**
```
⚠️ VOTE CYCLE COMPLETE (2/3)

👤 A1: NVDA, AAPL, META, AMZN, MSFT, TSLA, GOOGL
👤 A2: ❌ Server timeout (502/504)
👤 A3: META, AAPL, NVDA, AMZN, GOOGL, MSFT, NFLX

🎯 Strategy: demand
🕐 Time: 3/7/2026, 15.09.00
⏰ Next: 17.05.00
```

**Already voted:**
```
ℹ️ ALREADY VOTED (3/3)

👤 A1: Already submitted
👤 A2: Already submitted
👤 A3: Already submitted

🕐 Time: 3/7/2026, 15.09.00
⏰ Next: 17.05.00
```

**Between rounds:**
```
⏳ BETWEEN ROUNDS

Calls are being prepared. Bot will auto-vote when ready.
```

---

## 🎯 Voting Strategies

Set `VOTE_STRATEGY` in `.env` to choose how the bot picks assets.

| Strategy | Description |
|---|---|
| `smart` | Random 50/50 pick (default, same as `random`) |
| `random` | Random 50/50 pick |
| `first` | Always pick Asset A (left side) |
| `second` | Always pick Asset B (right side) |
| `marketcap` | Pick the asset with higher market cap |
| `popular` | Pick by brand/hype tier (AI/tech hype > blue chips > rest) |
| `underdog` | Pick the smaller company (contrarian strategy) |
| `demand` | Pick based on Edel's Demand Index (actual voting history) |
| `pick-<TICKER>` | Always pick a specific ticker when it appears |

See [strategies.js](src/bot/strategies.js) for detailed rankings and logic.

---

## ⏰ Smart Scheduling

The bot automatically syncs with Edel's round windows instead of using a fixed timer.

**How it works:**
1. After voting, the bot reads `nextRoundStartsAt` from the API
2. Waits until that time + a random buffer of **+5 to +9 minutes**
3. This random delay makes the bot look more human-like
4. If round timing is unavailable (API down), falls back to fixed interval

**Example:**
```
Round opens at 15:00 → Bot votes at 15:07 (+7 min buffer)
Round opens at 16:00 → Bot votes at 16:05 (+5 min buffer)
Round opens at 17:00 → Bot votes at 17:09 (+9 min buffer)
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `VOTE_STRATEGY` | `smart` | `smart` / `random` / `first` / `second` / `marketcap` / `popular` / `underdog` / `demand` / `pick-<TICKER>` |
| `VOTE_INTERVAL_MINUTES` | `60` | Fallback interval if round timing unavailable |
| `VOTE_BUFFER_MINUTES` | `2` | Fallback buffer (random +5 to +9 min used by default) |
| `RETRY_INTERVAL_MINUTES` | `1` | Minutes between retries on failure |
| `MAX_RETRIES` | `3` | Number of retries per vote cycle |
| `TELEGRAM_BOT_TOKEN` | _(empty)_ | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | _(empty)_ | Your Telegram Chat ID |
| `LOG_LEVEL` | `info` | `info` / `debug` for troubleshooting |

---

## 📁 Folder Structure

```
edel-runway-bot/
├── accounts.txt            # Account list (edit this!)
├── accounts.json           # Runtime state (auto-generated)
├── package.json
├── .env                    # Config (DO NOT COMMIT!)
├── .env.example            # Config template
├── src/
│   ├── index.js            # CLI entry point
│   ├── accounts/
│   │   └── manager.js      # Multi-account manager
│   ├── api/
│   │   └── client.js       # HTTP API client (per-account session)
│   ├── auth/
│   │   ├── session.js      # Cookie import/export
│   │   └── telegram-import.js  # Telegram cookie refresh (A1: format)
│   ├── bot/
│   │   ├── voter.js        # Voting logic
│   │   └── strategies.js   # Voting strategies (9 strategies)
│   ├── scheduler/
│   │   └── cron.js         # Sequential multi-account scheduler
│   └── utils/
│       ├── config.js       # Config loader
│       ├── display.js      # TUI display
│       ├── logger.js       # Winston logger
│       └── telegram.js     # Telegram notifications
├── sessions/               # Per-account session files (A1.json, A2.json, ...)
└── logs/                   # Log files
```

---

## ⚠️ Troubleshooting

### "No enabled accounts"
Edit `accounts.txt` and add your accounts, then run `npm run import`.

### "SESSION_EXPIRED"
Paste new cookie in Telegram: `A1: edel_session=eyJ...`

### "No round available"
Between rounds — bot will auto-retry when calls open.

### Telegram notifications not working
1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
2. Send a message to your bot first
3. Check: `https://api.telegram.org/bot<TOKEN>/getUpdates`

### Debug mode
```bash
LOG_LEVEL=debug npm run start
```

---

## 📜 Disclaimer

> This bot is built for educational purposes. Automation may violate
> the Terms & Conditions of Edel Finance. Use at your own risk.

---

**Forked from [AaBatok/Edel](https://github.com/AaBatok/Edel) | Enhanced by Devin1-tri** ⚡
