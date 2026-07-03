# 🤖 Edel Runway Desk - Auto Vote Bot

Automated daily voting bot for **Listing Calls** on [Edel Finance Runway Desk](https://runway.edel.finance/listing-calls).

Fork of [AaBatok/Edel](https://github.com/AaBatok/Edel) with additional voting strategies.

## ✨ Features

- **Multi-Account** — run 3-5 accounts sequentially (no collision, no missed rounds)
- **Auto Vote** every round (syncs with round window automatically)
- **Smart Scheduling** — waits for next round to open + random 5-9 min buffer (no fixed interval)
- **Multiple Voting Strategies** — marketcap, popular, underdog, demand, or always-pick-a-ticker
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

## 👥 Multi-Account

Run multiple Edel accounts from a single bot. Votes are sequential (no collision).

### Setup

```bash
# Add accounts
node src/index.js add-account A1 "Main Account"
node src/index.js add-account A2 "Second Account"
node src/index.js add-account A3 "Third Account"

# List accounts
node src/index.js accounts
```

### Import Session per Account

Each account needs its own session cookie. Copy the cookie from Chrome and save:

```bash
# For A1: save session to sessions/A1.json
# For A2: save session to sessions/A2.json
# etc.
```

### Vote Flow

```
Round opens → +5-9 min (random buffer)
→ Account A1 votes → 1 min delay
→ Account A2 votes → 1 min delay
→ Account A3 votes
→ All done → sync with next round
```

**Total time:** ~10-14 min for 3 accounts, ~14-18 min for 5 accounts.

### Account Management

```bash
node src/index.js accounts          # List all accounts
node src/index.js disable A2        # Disable an account
node src/index.js enable A2         # Re-enable
node src/index.js remove-account A3 # Remove permanently
```

### Migration from Single Account

If you have an existing `sessions/state.json`, the bot automatically migrates it to `A1` on first run.

---

## ⏰ Smart Scheduling

The bot automatically syncs with Edel's round windows instead of using a fixed timer.

**How it works:**
1. After voting (or detecting "already submitted"), the bot reads `nextRoundStartsAt` from the API
2. Waits until that time + a random buffer of **+5 to +9 minutes**
3. This random delay makes the bot look more human-like
4. If round timing is unavailable (API down), falls back to fixed 65-min interval

**Example:**
```
Round opens at 15:00 → Bot votes at 15:07 (+7 min buffer)
Round opens at 16:00 → Bot votes at 16:05 (+5 min buffer)
Round opens at 17:00 → Bot votes at 17:09 (+9 min buffer)
```

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
| `VOTE_INTERVAL_MINUTES` | `60` | Fallback interval if round timing unavailable |
| `VOTE_BUFFER_MINUTES` | `2` | Fallback buffer (random +5 to +9 min used by default) |
| `RETRY_INTERVAL_MINUTES` | `1` | Minutes between retries on failure |
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
├── accounts.json           # Multi-account registry (auto-generated)
├── src/
│   ├── index.js            # CLI entry point
│   ├── accounts/
│   │   └── manager.js      # Multi-account CRUD
│   ├── api/
│   │   └── client.js       # HTTP API client (per-account session)
│   ├── auth/
│   │   ├── session.js      # Cookie import/export
│   │   └── telegram-import.js
│   ├── bot/
│   │   ├── voter.js        # Voting logic
│   │   └── strategies.js   # Voting strategies
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
