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
 *   3. After all accounts done, sync with next round window
 *   4. Repeat forever
 */
import config from '../utils/config.js';
import logger, { logSeparator } from '../utils/logger.js';
import { performVote } from '../bot/voter.js';
import { waitForCookieViaTelegram } from '../auth/telegram-import.js';
import { initDisplay, updateStatus, destroyDisplay } from '../utils/display.js';
import {
  notifyVoteSuccess,
  notifyVoteFailed,
  notifySessionExpired,
  notifyBotStarted,
  notifyNextVote,
  sendTelegram,
} from '../utils/telegram.js';
import {
  getEnabledAccounts,
  getAccountCount,
  updateAccountStatus,
  initDefaultAccount,
} from '../accounts/manager.js';

// Track last notified state to avoid spam
let lastNotifiedState = null;
let sessionExpiredNotified = false;

// Track active timer for graceful shutdown
let nextVoteTimer = null;

// Delay between accounts (ms)
const ACCOUNT_DELAY_MS = 1 * 60 * 1000; // 1 minute

/**
 * Vote for a single account with retry logic.
 * Returns { status, roundTiming, accountId }
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
          logger.info(`${tag}✅ Already submitted for this round.`);
          updateAccountStatus(accountId, { lastVoteStatus: 'already_voted' });
          return { status: 'already_voted', roundTiming, accountId };
        } else if (result.details?.note) {
          logger.info(`${tag}⏳ ${result.details.note}`);
          updateAccountStatus(accountId, { lastVoteStatus: 'waiting' });
          return { status: 'waiting', roundTiming, accountId };
        } else {
          logger.info(`${tag}🎉 Vote success!`);
          updateAccountStatus(accountId, { lastVoteStatus: 'voted' });
          await notifyVoteSuccess({ ...result.details, accountId });
          return { status: 'voted', roundTiming, accountId };
        }
      }

      // Session expired
      if (result.details?.sessionExpired) {
        logger.error(`${tag}🔑 Session expired.`);
        if (!sessionExpiredNotified) {
          sessionExpiredNotified = true;
          await notifySessionExpired();
        }
        updateAccountStatus(accountId, { lastVoteStatus: 'failed' });
        return { status: 'failed', roundTiming, accountId, sessionExpired: true };
      }

      lastError = result.details?.error;
      const shortError = (lastError || '').includes('502') || (lastError || '').includes('504')
        ? 'Server timeout (502/504)'
        : (lastError || '').substring(0, 100);
      logger.warn(`${tag}⚠️  Attempt ${attempt}/${config.maxRetries} failed: ${shortError}`);

      await notifyVoteFailed({
        ...result.details,
        accountId,
        attempt,
        maxAttempts: config.maxRetries,
        willRetry: attempt < config.maxRetries,
      });
    } catch (err) {
      lastError = err.message;
      const shortCrash = (lastError || '').includes('502') || (lastError || '').includes('504')
        ? 'Server timeout (502/504)'
        : (lastError || '').substring(0, 100);
      logger.error(`${tag}💥 Attempt ${attempt}/${config.maxRetries} crashed: ${shortCrash}`);

      await notifyVoteFailed({
        error: err.message,
        accountId,
        strategy: config.voteStrategy,
        attempt,
        maxAttempts: config.maxRetries,
        willRetry: attempt < config.maxRetries,
      });
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
  return { status: 'failed', roundTiming, accountId };
}

/**
 * Vote for all enabled accounts sequentially.
 * Returns { overallStatus, roundTiming }
 */
async function voteAllAccounts() {
  const accounts = getEnabledAccounts();

  if (accounts.length === 0) {
    logger.warn('⚠️  No enabled accounts. Add accounts with: npm run add-account');
    return { overallStatus: 'failed', roundTiming: null };
  }

  logger.info(`👥 Voting for ${accounts.length} account(s)...`);

  let overallStatus = 'waiting';
  let roundTiming = null;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    if (i > 0) {
      // Delay between accounts (except before first)
      logger.info(`⏳ Waiting 1 min before next account...`);
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_DELAY_MS));
    }

    const result = await voteForAccount(account);
    results.push(result);

    // Capture round timing from any account
    if (result.roundTiming) {
      roundTiming = result.roundTiming;
    }

    // Track overall status
    if (result.status === 'voted') {
      overallStatus = 'voted';
    } else if (result.status === 'already_voted' && overallStatus !== 'voted') {
      overallStatus = 'already_voted';
    } else if (result.status === 'failed' && overallStatus === 'waiting') {
      overallStatus = 'failed';
    }
  }

  // Summary log
  logSeparator();
  logger.info(`📊 Voting summary:`);
  for (const r of results) {
    const icon = r.status === 'voted' ? '✅' : r.status === 'already_voted' ? 'ℹ️' : '❌';
    logger.info(`   ${icon} ${r.accountId}: ${r.status}`);
  }

  return { overallStatus, roundTiming };
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
          const nextStr = new Date(nextRound + bufferMs).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
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
      const { overallStatus, roundTiming } = await voteAllAccounts();
      const nextDelay = getNextDelay(overallStatus, roundTiming);
      const scheduledTime = scheduleNextVote(nextDelay);

      // Smart notification: only notify on state change
      if (overallStatus === 'voted') {
        await notifyNextVote(scheduledTime);
        lastNotifiedState = 'voted';
      } else if (overallStatus === 'already_voted' && lastNotifiedState !== 'already_voted') {
        await notifyNextVote(scheduledTime);
        lastNotifiedState = 'already_voted';
      } else if (overallStatus === 'waiting' && lastNotifiedState !== 'waiting') {
        await sendTelegram(`⏳ *BETWEEN ROUNDS*\n\nCalls are being prepared. Bot will auto-vote when ready.`);
        lastNotifiedState = 'waiting';
      }
    } catch (err) {
      logger.error(`Scheduled vote cycle error: ${err.message}`);
      const retryDelay = config.retryIntervalMinutes * 60 * 1000;
      scheduleNextVote(retryDelay);
    }
  }, delayMs);

  return nextTime;
}

/**
 * Start the dynamic vote scheduler.
 */
export async function startScheduler() {
  // Migrate single-account to multi-account if needed
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

  logger.info('▶️  Running initial vote cycle...');
  const { overallStatus, roundTiming } = await voteAllAccounts();

  const nextDelay = getNextDelay(overallStatus, roundTiming);
  const nextTime = scheduleNextVote(nextDelay);
  await notifyNextVote(nextTime);

  logger.info('');
  logger.info('📡 Bot is running with dynamic scheduling...');

  const shutdown = async () => {
    logger.info('');
    logger.info('🛑 Bot stopping...');
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
