/**
 * Multi-account sequential vote scheduler.
 *
 * Flow:
 *   1. Wait for round to open + random buffer (+5-9 min)
 *   2. Vote for each enabled account sequentially:
 *      - Account 1 → vote (max 3 retries)
 *      - Wait 1 min
 *      - Account 2 → vote (max 3 retries)
 *      - Wait 1 min
 *      - Account 3 → vote (max 3 retries)
 *      - ... etc
 *   3. Send ONE consolidated notification for the whole cycle
 *   4. Sync with next round window
 *   5. Repeat forever
 */
import config from '../utils/config.js';
import logger, { logSeparator } from '../utils/logger.js';
import { performVote } from '../bot/voter.js';
import { initDisplay, updateStatus, destroyDisplay } from '../utils/display.js';
import {
  notifyBotStarted,
  sendTelegram,
} from '../utils/telegram.js';
import {
  getEnabledAccounts,
  getAccountCount,
  updateAccountStatus,
  saveAccountSession,
  initDefaultAccount,
} from '../accounts/manager.js';

// Track last notified state to avoid spam
let lastNotifiedState = null;

// Track active timer for graceful shutdown
let nextVoteTimer = null;

// Track consecutive waiting cycles to avoid infinite retry
let waitingRetryCount = 0;
const MAX_WAITING_RETRIES = 8; // After 8 retries (16 min), move on

// Delay between accounts (ms)
const ACCOUNT_DELAY_MS = 1 * 60 * 1000; // 1 minute

/**
 * Vote for a single account with retry logic.
 * Returns { status, roundTiming, accountId, assets }
 */
async function voteForAccount(account) {
  const accountId = account.id;
  const tag = `[${accountId}] `;

  logger.info(`${tag}🔄 Starting vote...`);
  updateAccountStatus(accountId, { lastVote: new Date().toISOString(), lastVoteStatus: 'running' });

  let lastError = null;
  let roundTiming = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    logger.info(`${tag}🔄 Attempt ${attempt}/${config.maxRetries}`);

    try {
      const result = await performVote({ id: accountId, sessionFile: account.sessionFile });

      if (result.roundTiming) {
        roundTiming = result.roundTiming;
      }

      if (result.success) {
        if (result.details?.note?.includes('Already submitted')) {
          logger.info(`${tag}ℹ️  Already submitted.`);
          updateAccountStatus(accountId, { lastVoteStatus: 'already_voted' });
          return { status: 'already_voted', roundTiming, accountId, assets: null };
        } else if (result.details?.note) {
          logger.info(`${tag}⏳ ${result.details.note}`);
          updateAccountStatus(accountId, { lastVoteStatus: 'waiting' });
          return { status: 'waiting', roundTiming, accountId, assets: null };
        } else {
          logger.info(`${tag}✅ Vote success!`);
          updateAccountStatus(accountId, { lastVoteStatus: 'voted' });
          return { status: 'voted', roundTiming, accountId, assets: result.details?.asset || 'N/A' };
        }
      }

      // Session expired
      if (result.details?.sessionExpired) {
        logger.error(`${tag}🔑 Session expired.`);
        updateAccountStatus(accountId, { lastVoteStatus: 'failed' });
        return { status: 'failed', roundTiming, accountId, assets: null, error: 'Session expired', sessionExpired: true };
      }

      lastError = result.details?.error;
      const shortError = (lastError || '').includes('502') || (lastError || '').includes('504')
        ? 'Server timeout (502/504)'
        : (lastError || '').substring(0, 100);
      logger.warn(`${tag}⚠️  Attempt ${attempt}/${config.maxRetries} failed: ${shortError}`);
    } catch (err) {
      lastError = err.message;
      const shortCrash = (lastError || '').includes('502') || (lastError || '').includes('504')
        ? 'Server timeout (502/504)'
        : (lastError || '').substring(0, 100);
      logger.error(`${tag}💥 Attempt ${attempt}/${config.maxRetries} crashed: ${shortCrash}`);
    }

    if (attempt < config.maxRetries) {
      const delay = config.retryDelay * attempt;
      logger.info(`${tag}⏳ Waiting ${delay / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const shortFinal = (lastError || '').includes('502') || (lastError || '').includes('504')
    ? 'Server timeout (502/504)'
    : (lastError || '').substring(0, 100);
  logger.error(`${tag}❌ All ${config.maxRetries} attempts failed: ${shortFinal}`);
  updateAccountStatus(accountId, { lastVoteStatus: 'failed' });
  return { status: 'failed', roundTiming, accountId, assets: null, error: shortFinal };
}

/**
 * Build consolidated notification message.
 */
function buildCycleNotification(results, nextVoteTime) {
  const total = results.length;
  const voted = results.filter((r) => r.status === 'voted').length;
  const alreadyVoted = results.filter((r) => r.status === 'already_voted').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const waiting = results.filter((r) => r.status === 'waiting').length;

  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const nextStr = nextVoteTime
    ? nextVoteTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false })
    : 'N/A';

  // All already voted
  if (alreadyVoted === total) {
    return [
      `ℹ️ *ALREADY VOTED* (${total}/${total})`,
      '',
      ...results.map((r) => `👤 ${r.accountId}: Already submitted`),
      '',
      `🕐 Time: ${time}`,
      `⏰ Next: ${nextStr}`,
    ].join('\n');
  }

  // All waiting (between rounds)
  if (waiting === total) {
    return [
      '⏳ *BETWEEN ROUNDS*',
      '',
      'Calls are being prepared. Bot will auto-vote when ready.',
    ].join('\n');
  }

  // All failed
  if (failed === total) {
    return [
      `❌ *VOTE CYCLE FAILED* (${failed}/${total})`,
      '',
      ...results.map((r) => `👤 ${r.accountId}: ❌ ${r.error || 'Failed'}`),
      '',
      `🕐 Time: ${time}`,
      `⏰ Next: ${nextStr}`,
    ].join('\n');
  }

  // Partial success (some voted, some waiting)
  if (waiting > 0 && voted > 0) {
    return [
      `⏳ *PARTIAL VOTE* (${voted}/${total} voted, ${waiting} waiting)`,
      '',
      ...lines,
      '',
      `🎯 Strategy: \`${config.voteStrategy}\``,
      `🕐 Time: ${time}`,
      `⏰ Retrying waiting accounts in 2 min...`,
    ].join('\n');
  }

  // Mixed or all success
  const header = failed > 0
    ? `⚠️ *VOTE CYCLE COMPLETE* (${voted}/${total})`
    : `✅ *VOTE CYCLE COMPLETE* (${voted}/${total})`;

  const lines = results.map((r) => {
    if (r.status === 'voted') {
      return `👤 ${r.accountId}: ${r.assets || 'N/A'}`;
    } else if (r.status === 'already_voted') {
      return `👤 ${r.accountId}: Already submitted ℹ️`;
    } else {
      return `👤 ${r.accountId}: ❌ ${r.error || 'Failed'}`;
    }
  });

  return [
    header,
    '',
    ...lines,
    '',
    `🎯 Strategy: \`${config.voteStrategy}\``,
    `🕐 Time: ${time}`,
    `⏰ Next: ${nextStr}`,
  ].join('\n');
}

/**
 * Vote for all enabled accounts sequentially.
 * Sends ONE consolidated notification after all accounts done.
 */
async function voteAllAccounts() {
  const accounts = getEnabledAccounts();

  if (accounts.length === 0) {
    logger.warn('⚠️  No enabled accounts. Edit accounts.txt to add accounts.');
    return { overallStatus: 'failed', roundTiming: null };
  }

  logger.info(`👥 Voting for ${accounts.length} account(s)...`);

  // Stabilization delay — small initial wait before checking lock status
  const stabDelay = 10 + Math.floor(Math.random() * 6); // 10-15 seconds
  logger.info(`⏳ Stabilization delay: ${stabDelay}s...`);
  await new Promise((resolve) => setTimeout(resolve, stabDelay * 1000));

  let votedCount = 0;
  let waitingCount = 0;
  let failedCount = 0;
  let roundTiming = null;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    if (i > 0) {
      logger.info(`⏳ Waiting 1 min before next account...`);
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_DELAY_MS));
    }

    const result = await voteForAccount(account);
    results.push(result);

    if (result.roundTiming) {
      roundTiming = result.roundTiming;
    }

    if (result.status === 'voted' || result.status === 'already_voted') {
      votedCount++;
    } else if (result.status === 'waiting') {
      waitingCount++;
    } else {
      failedCount++;
    }
  }

  // Determine overall status based on counts
  let overallStatus;
  if (waitingCount > 0 && votedCount > 0) {
    overallStatus = 'partial'; // Some voted, some waiting — retry waiting accounts
  } else if (waitingCount > 0) {
    overallStatus = 'waiting'; // All waiting
  } else if (votedCount > 0) {
    overallStatus = 'voted'; // All voted
  } else {
    overallStatus = 'failed'; // All failed
  }

  // Summary log
  logSeparator();
  logger.info(`📊 Voting summary:`);
  for (const r of results) {
    const icon = r.status === 'voted' ? '✅' : r.status === 'already_voted' ? 'ℹ️' : '❌';
    logger.info(`   ${icon} ${r.accountId}: ${r.status}${r.assets ? ` (${r.assets})` : ''}`);
  }

  // Calculate next vote time for notification
  let nextDelay = getNextDelay(overallStatus, roundTiming);

  // If stuck waiting or partial (some voted, some waiting), keep retrying
  // as long as the round window is still open
  if (overallStatus === 'waiting' || overallStatus === 'partial') {
    // Check if round window is still open
    const closesAt = roundTiming?.selectionClosesAt
      ? new Date(roundTiming.selectionClosesAt).getTime()
      : 0;
    const now = Date.now();
    const windowStillOpen = closesAt > 0 && now < closesAt;

    if (windowStillOpen) {
      // Round window still open — keep retrying
      const remainingMin = Math.round((closesAt - now) / 60000);
      logger.info(`⏳ ${overallStatus} — round window still open (${remainingMin} min left). Retrying in ${config.retryIntervalMinutes} min.`);
      nextDelay = config.retryIntervalMinutes * 60 * 1000;
    } else {
      // Round window closed or unknown — move to next round
      logger.info(`⏰ Round window closed. Moving to next round.`);
      nextDelay = getNextDelay('voted', roundTiming);
    }
  } else {
    waitingRetryCount = 0; // Reset on success or failure
  }

  const nextVoteTime = new Date(Date.now() + nextDelay);

  // Send consolidated notification
  const notifMsg = buildCycleNotification(results, nextVoteTime);
  const shouldNotify = overallStatus === 'voted'
    || (overallStatus === 'already_voted' && lastNotifiedState !== 'already_voted')
    || (overallStatus === 'waiting' && lastNotifiedState !== 'waiting')
    || (overallStatus === 'partial' && lastNotifiedState !== 'partial')
    || overallStatus === 'failed';

  if (shouldNotify) {
    await sendTelegram(notifMsg);
    lastNotifiedState = overallStatus;
  }

  return { overallStatus, roundTiming, nextDelay };
}

/**
 * Determine next delay (in ms) based on vote cycle result.
 */
function getNextDelay(result, roundTiming = null) {
  const retryMs = config.retryIntervalMinutes * 60 * 1000;

  if (roundTiming) {
    logger.info(`📅 Round timing detected: nextRoundStartsAt=${roundTiming.nextRoundStartsAt}`);
  } else {
    logger.info(`📅 No round timing for '${result}' — will use fixed interval`);
  }

  switch (result) {
    case 'voted':
    case 'already_voted': {
      if (roundTiming?.nextRoundStartsAt) {
        const nextRound = new Date(roundTiming.nextRoundStartsAt).getTime();
        const bufferMin = 5 + Math.floor(Math.random() * 5);
        const bufferMs = bufferMin * 60 * 1000;
        const delay = nextRound + bufferMs - Date.now();

        if (delay > 0) {
          const delayMin = Math.round(delay / 60000);
          logger.info(`📅 Syncing with round: next opens at ${new Date(nextRound).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}, voting in ${delayMin} min (+${bufferMin} min buffer)`);
          return delay;
        }
      }

      logger.info(`📅 No round timing available for '${result}', using fixed interval`);
      return (config.voteIntervalMinutes + config.voteBufferMinutes) * 60 * 1000;
    }
    case 'waiting':
    case 'failed':
    default:
      return retryMs;
  }
}

/**
 * Schedule the next vote cycle.
 */
function scheduleNextVote(delayMs) {
  if (nextVoteTimer) {
    clearTimeout(nextVoteTimer);
    nextVoteTimer = null;
  }

  const nextTime = new Date(Date.now() + delayMs);
  const nextStr = nextTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const delayMin = Math.round(delayMs / 60000);

  const nextHHmm = nextTime.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  updateStatus({
    status: 'LIVE',
    nextVote: nextHHmm,
    countdown: `${delayMin}m lagi`,
  });

  logger.info(`⏰ Next vote scheduled: ${nextStr} (in ${delayMin} minutes)`);

  nextVoteTimer = setTimeout(async () => {
    try {
      const { overallStatus, roundTiming, nextDelay } = await voteAllAccounts();
      scheduleNextVote(nextDelay);
    } catch (err) {
      logger.error(`Scheduled vote cycle error: ${err.message}`);
      const retryDelay = config.retryIntervalMinutes * 60 * 1000;
      scheduleNextVote(retryDelay);
    }
  }, delayMs);

  return nextTime;
}

/**
 * Background cookie listener — runs alongside vote scheduler.
 * Directly polls Telegram API for cookie messages (A1: eyJ..., A2: eyJ...).
 * Auto-saves cookies to account session files without blocking vote cycles.
 */
let _cookieListenerRunning = false;
let _cookieOffset = 0;
let _cookieOffsetInit = false;

function startCookieListener() {
  if (_cookieListenerRunning) return;
  if (!config.telegramBotToken || !config.telegramChatId) return;

  _cookieListenerRunning = true;
  logger.info('🍪 Background cookie listener started');

  const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;

  const poll = async () => {
    if (!_cookieListenerRunning) return;

    try {
      // Init offset on first run
      if (!_cookieOffsetInit) {
        _cookieOffsetInit = true;
        try {
          const initRes = await fetch(`${TELEGRAM_API}/getUpdates?offset=-1&limit=1`);
          const initData = await initRes.json();
          if (initData.ok && initData.result.length > 0) {
            _cookieOffset = initData.result[initData.result.length - 1].update_id + 1;
          }
        } catch (e) { /* ignore */ }
      }

      // Poll for new messages
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${_cookieOffset}&timeout=5`);
      const data = await res.json();

      if (!data.ok) {
        setTimeout(poll, 30000);
        return;
      }

      for (const update of data.result) {
        _cookieOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (String(msg.chat.id) !== String(config.telegramChatId)) continue;

        const text = msg.text.trim();

        // Skip short messages and commands
        if (text.length < 20 || text.startsWith('/')) continue;

        // Parse account prefix: "A1: eyJ..." or "A2: edel_session=eyJ..."
        let accountId = 'A1';
        let cookieText = text;
        const prefixMatch = text.match(/^(A\d+):\s*/i);
        if (prefixMatch) {
          accountId = prefixMatch[1].toUpperCase();
          cookieText = text.substring(prefixMatch[0].length).trim();
        }

        // Parse cookies
        let cookies = [];
        if (cookieText.includes('edel_session=')) {
          const pairs = cookieText.split(/;\s*/);
          for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const name = pair.substring(0, eqIdx).trim();
            const value = pair.substring(eqIdx + 1).trim();
            if (!name) continue;
            cookies.push({ name, value, domain: 'runway.edel.finance', path: '/', expires: Date.now() / 1000 + 86400 * 30, httpOnly: false, secure: true, sameSite: 'Lax' });
          }
          if (!cookies.some(c => c.name === 'edel_session')) cookies = [];
        } else if (cookieText.startsWith('eyJ') && cookieText.length > 50 && !cookieText.includes(' ')) {
          cookies = [{ name: 'edel_session', value: cookieText, domain: 'runway.edel.finance', path: '/', expires: Date.now() / 1000 + 86400 * 30, httpOnly: false, secure: true, sameSite: 'Lax' }];
        }

        if (cookies.length === 0) continue;

        // Save to account
        try {
          saveAccountSession(accountId, cookies);
          const preview = cookies.find(c => c.name === 'edel_session')?.value?.substring(0, 20) || 'N/A';
          logger.info(`🍪 ${accountId} cookie received via Telegram! Token: ${preview}...`);
          await sendTelegram(`✅ *${accountId} SESSION UPDATED*\n\n🍪 ${cookies.length} cookies saved\n🔑 Token: \`${preview}...\`\n\n▶️ Will use on next vote.`);

          // Delete cookie message for security
          try {
            await fetch(`${TELEGRAM_API}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: config.telegramChatId, message_id: msg.message_id }),
            });
          } catch (e) { /* ignore */ }
        } catch (err) {
          logger.debug(`Cookie save error for ${accountId}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.debug(`Cookie listener error: ${err.message}`);
    }

    // Schedule next poll
    if (_cookieListenerRunning) {
      setTimeout(poll, 10000); // Check every 10s
    }
  };

  poll();
}

function stopCookieListener() {
  _cookieListenerRunning = false;
}

/**
 * Start the dynamic vote scheduler.
 */
export async function startScheduler() {
  initDefaultAccount();

  const accountCount = getAccountCount();

  initDisplay({
    strategy: config.voteStrategy,
    interval: 'auto',
  });

  logger.info(`👥 Accounts  : ${accountCount} configured`);
  logger.info(`📅 Scheduling: syncs with round window + random +5-9 min buffer`);
  logger.info(`🔄 Retry     : every ${config.retryIntervalMinutes}m`);
  logger.info(`🎯 Strategy  : ${config.voteStrategy}`);
  logger.info(`📨 Telegram  : ${config.telegramBotToken ? 'Configured ✅' : 'Not configured ⚠️'}`);
  logger.info('');

  await notifyBotStarted();

  // Start background cookie listener for Telegram session updates
  startCookieListener();

  logger.info('▶️  Running initial vote cycle...');
  const { overallStatus, roundTiming, nextDelay } = await voteAllAccounts();

  scheduleNextVote(nextDelay);

  logger.info('');
  logger.info('📡 Bot is running with dynamic scheduling...');

  const shutdown = async () => {
    logger.info('');
    logger.info('🛑 Bot stopping...');
    stopCookieListener();
    destroyDisplay();
    if (nextVoteTimer) {
      clearTimeout(nextVoteTimer);
      nextVoteTimer = null;
    }
    const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    await sendTelegram(`🛑 *BOT STOPPED*\n\n🕐 Time: ${time}`);
    logger.info('👋 Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Run a single vote for all accounts (no scheduling)
 */
export async function runSingleVote() {
  logSeparator();
  logger.info('🗳️  Running single vote for all accounts...');
  await voteAllAccounts();
  logger.info('✅ Single vote cycle complete.');
}
