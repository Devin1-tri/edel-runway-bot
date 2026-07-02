# 🤖 Edel Runway Desk - Auto Vote Bot

Automated daily voting bot for **Listing Calls** on [Edel Finance Runway Desk](https://runway.edel.finance/listing-calls).

Fork of [AaBatok/Edel](https://github.com/AaBatok/Edel) with additional voting strategies.

## ✨ Features

- **Auto Vote** every 1 hour (configurable interval)
- **Multiple Voting Strategies** — marketcap, popular, underdog, or always-pick-a-ticker
- **Telegram Notifications** — real-time alerts on vote success/failure
- **Session Import** — login in Chrome, copy cookie, paste on VPS
- **Retry Logic** — auto retry with exponential backoff
- **VPS Ready** — runs in `screen`, auto-restart on failure

## 📋 Prerequisites

- **Node.js v18+** → [Download](https://nodejs.org/)
- **Runway Desk account** → [Register](https://runway.edel.finance/register)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Devin1-tri/edel-runway-bot.git
cd edel-runway-bot
npm install
```

### 2. Configure

```bash
cp .env.example .env
nano .env
```

Set `VOTE_STRATEGY` to your preferred strategy (see below).

### 3. Setup Telegram Bot (Optional but Recommended)

1. Open Telegram, search for **@BotFather**
2. Send `/newbot` → follow instructions → get **Bot Token**
3. Open your bot, send any message (e.g. "hello")
4. Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Find `"chat":{"id": 123456789}` → that's your **Chat ID**
6. Enter both in `.env`

### 4. Import Session from Chrome

```bash
npm run import
```

How to get the cookie:

1. **Login** in Chrome → open https://runway.edel.finance
2. Press **F12** (DevTools) → click **Network** tab
3. **Refresh** the page (Ctrl+R)
4. **Click** the first request in the list
5. In the right panel, find **"Cookie:"** under Request Headers
6. **Copy** the entire value
7. On VPS: `npm run import` → **paste** → Enter

> 💡 The important part is the `edel_session=eyJ...` cookie (JWT token).
> You can also paste just the token starting with `eyJ...`

### 5. Run in Screen

```bash
screen -S edel
npm run start
# Press Ctrl+A then D to detach (bot keeps running)
```

### Screen Commands

```bash
screen -S edel          # Create new screen
screen -r edel          # Reattach to existing screen
screen -ls              # List all active screens
# Ctrl+A then D         # Detach (exit without stopping)
# Ctrl+C                # Stop bot (inside screen)
```

### Update Bot

```bash
cd edel-runway-bot
git pull origin main
npm install
```

### Re-import Session (if expired)

```bash
screen -r edel          # Enter screen
# Ctrl+C                # Stop bot
npm run import          # Paste new cookie
npm run start           # Restart
# Ctrl+A then D         # Detach
```

---

## 🎯 Voting Strategies

Set `VOTE_STRATEGY` in `.env` to choose how the bot picks assets in each head-to-head matchup.

| Strategy | Description |
|---|---|
| `smart` | Random 50/50 pick (default, same as `random`) |
| `random` | Random 50/50 pick |
| `first` | Always pick Asset A (left side) |
| `second` | Always pick Asset B (right side) |
| `marketcap` | Pick the asset with higher market cap |
| `popular` | Pick by brand/hype tier (AI/tech hype > blue chips > rest) |
| `underdog` | Pick the smaller company (contrarian strategy) |
| `demand` | Pick based on Edel's Demand Index (actual voting history — community behavior) |
| `pick-<TICKER>` | Always pick a specific ticker when it appears in a matchup |

### Strategy Details

#### `marketcap`
Picks the asset with the larger market capitalization. When NVDA faces GOOGL, it picks NVDA. When JPM faces PLTR, it picks JPM. Falls back to random if the ticker isn't in the known ranking.

**Best for:** Playing it safe with established large-cap companies.

#### `popular`
Picks based on brand recognition and hype:
- **Tier 1 (AI/Hype):** NVDA, PLTR, TSLA, AMD, AMZN, GOOGL, META, MSFT, AAPL, NFLX
- **Tier 2 (Blue Chips):** JPM, V, MA, LLY, AVGO, XOM, JNJ, WMT, HD, COST
- **Tier 3 (Everything else):** All other assets

Within the same tier, picks randomly.

**Best for:** Backing the "popular" picks that other voters likely choose.

#### `underdog`
Picks the asset with the *lower* market cap. The contrarian approach — smaller companies may have more upside, and the "underdog" narrative can be compelling in listing calls.

**Best for:** Contrarian plays and supporting smaller companies.

#### `demand`
Picks based on Edel's actual Demand Index — the real voting history from the community. The asset ranked higher in the Demand Index (more wins, higher score) gets picked.

Current top 5: NVDA > TSLA > NFLX > AAPL > MSFT

This is the most data-driven strategy since it uses actual community behavior rather than assumptions.

**Best for:** Aligning with proven community preferences — vote with the winners.

#### `pick-<TICKER>`
Always picks a specific ticker whenever it appears in a matchup. Falls back to random for matchups that don't include that ticker.

Examples:
```bash
VOTE_STRATEGY=pick-NVDA    # Always pick Nvidia
VOTE_STRATEGY=pick-AAPL    # Always pick Apple
VOTE_STRATEGY=pick-PLTR    # Always pick Palantir
```

**Best for:** Conviction plays on a specific stock.

---

## 📨 Telegram Notifications

| Event | Message |
|---|---|
| ✅ Vote success | Assets picked, strategy, timestamp |
| ❌ Vote failed | Error details, retry info |
| ℹ️ Already voted | Round status, next schedule |
| 🔑 Session expired | Re-import instructions |
| 🤖 Bot started | Config summary |
| ⏰ Next vote | Estimated next vote time |
| 🛑 Bot stopped | Shutdown timestamp |

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `VOTE_STRATEGY` | `smart` | `smart` / `random` / `first` / `second` / `marketcap` / `popular` / `underdog` / `demand` / `pick-<TICKER>` |
| `VOTE_INTERVAL_MINUTES` | `60` | Minutes between vote cycles |
| `VOTE_BUFFER_MINUTES` | `2` | Extra buffer after round closes |
| `RETRY_INTERVAL_MINUTES` | `5` | Minutes between retries on failure |
| `MAX_RETRIES` | `3` | Number of retries per vote cycle |
| `TELEGRAM_BOT_TOKEN` | _(empty)_ | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | _(empty)_ | Your Telegram Chat ID |
| `LOG_LEVEL` | `info` | `info` / `debug` for troubleshooting |

## 📁 Folder Structure

```
edel-runway-bot/
├── package.json
├── .env                    # Config (DO NOT COMMIT!)
├── .env.example            # Config template
├── ecosystem.config.cjs    # PM2 config (optional)
├── src/
│   ├── index.js            # CLI entry point
│   ├── api/
│   │   └── client.js       # HTTP API client
│   ├── auth/
│   │   └── session.js      # Cookie import/export
│   ├── bot/
│   │   ├── voter.js        # Voting logic
│   │   └── strategies.js   # Voting strategies
│   ├── scheduler/
│   │   └── cron.js         # Cron scheduler + Telegram
│   └── utils/
│       ├── config.js       # Config loader
│       ├── logger.js       # Winston logger
│       └── telegram.js     # Telegram notifications
├── sessions/               # Cookie session (DO NOT COMMIT!)
└── logs/                   # Log files
```

## ⚠️ Troubleshooting

### "SESSION_EXPIRED"
The `edel_session` cookie has expired.
→ Login again in Chrome → F12 → copy cookie → `npm run import`

### "No round available"
No listing call window is currently open.
→ The bot will automatically retry at the next scheduled interval.

### Telegram notifications not working
1. Make sure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env`
2. Send a message to your bot first (bots can't initiate conversations)
3. Check: `https://api.telegram.org/bot<TOKEN>/getUpdates`

### Debug mode
```bash
LOG_LEVEL=debug npm run vote
```

## 📜 Disclaimer

> This bot is built for educational purposes. Automation may violate
> the Terms & Conditions of Edel Finance. Use at your own risk.

---

**Forked from [AaBatok/Edel](https://github.com/AaBatok/Edel) | Enhanced by Devin1-tri** ⚡
