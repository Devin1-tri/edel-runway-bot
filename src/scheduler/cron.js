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
import { waitForCookieViaTelegram } from '../auth/telegram-import.js';
import { initDisplay, updateStatus, destroyDisplay } from '../utils/display.js';
import {
  notifyBotStarted,
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

// Track active timer for graceful shutdown
let nextVoteTimer = null;

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

  let overallStatus = 'waiting';
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

    if (result.status === 'voted') {
      if (overallStatus !== 'waiting') overallStatus = 'voted';
    } else if (result.status === 'already_voted') {
      if (overallStatus !== 'voted' && overallStatus !== 'waiting') overallStatus = 'already_voted';
    } else if (result.status === 'waiting') {
      // If ANY account is still waiting, don't skip to next round
      overallStatus = 'waiting';
    } else if (result.status === 'failed' && overallStatus !== 'waiting') {
      overallStatus = 'failed';
    }
  }

  // Summary log
  logSeparator();
  logger.info(`📊 Voting summary:`);
  for (const r of results) {
    const icon = r.status === 'voted' ? '✅' : r.status === 'already_voted' ? 'ℹ️' : '❌';
    logger.info(`   ${icon} ${r.accountId}: ${r.status}${r.assets ? ` (${r.assets})` : ''}`);
  }

  // Calculate next vote time for notification
  const nextDelay = getNextDelay(overallStatus, roundTiming);
  const nextVoteTime = new Date(Date.now() + nextDelay);

  // Send consolidated notification
  const notifMsg = buildCycleNotification(results, nextVoteTime);
  const shouldNotify = overallStatus === 'voted'
    || (overallStatus === 'already_voted' && lastNotifiedState !== 'already_voted')
    || (overallStatus === 'waiting' && lastNotifiedState !== 'waiting')
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

  logger.info('▶️  Running initial vote cycle...');
  const { overallStatus, roundTiming, nextDelay } = await voteAllAccounts();

  scheduleNextVote(nextDelay);

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
