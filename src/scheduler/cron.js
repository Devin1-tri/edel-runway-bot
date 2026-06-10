import cron from 'node-cron';
import config from '../utils/config.js';
import logger, { logSeparator } from '../utils/logger.js';
import { getAuthenticatedSession } from '../auth/login.js';
import { performVote } from '../bot/voter.js';
import {
  notifyVoteSuccess,
  notifyVoteFailed,
  notifySessionExpired,
  notifyBotStarted,
  notifyNextVote,
  notifyAlreadyVoted,
} from '../utils/telegram.js';

/**
 * Execute a single vote cycle with retry logic
 */
async function voteCycle() {
  logSeparator();
  logger.info(`⏰ Vote cycle started at ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);

  let lastError = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    logger.info(`🔄 Attempt ${attempt}/${config.maxRetries}`);

    // Get authenticated browser session
    const session = await getAuthenticatedSession();
    if (!session) {
      logger.error('❌ Cannot get authenticated session. Bot needs re-setup.');
      logger.info('   Jalankan: npm run setup');
      await notifySessionExpired();
      return;
    }

    const { browser, context, page } = session;

    try {
      const result = await performVote(page, context);

      if (result.success) {
        logger.info('🎉 Vote cycle completed successfully!');

        // Send Telegram notification
        if (result.details?.note?.includes('Already voted')) {
          await notifyAlreadyVoted(result.details.note);
        } else {
          await notifyVoteSuccess(result.details);
        }
        await notifyNextVote();

        await browser.close();
        return;
      }

      // Check if it's a session error (don't retry, need re-setup)
      if (result.details?.error?.includes('Session expired')) {
        logger.error('🔑 Session expired. Need re-setup.');
        await notifySessionExpired();
        await browser.close();
        return;
      }

      lastError = result.details?.error;
      logger.warn(`⚠️  Vote attempt ${attempt} failed: ${lastError}`);

      // Notify failure (with retry info)
      await notifyVoteFailed({
        ...result.details,
        attempt,
        maxAttempts: config.maxRetries,
        willRetry: attempt < config.maxRetries,
      });
    } catch (err) {
      lastError = err.message;
      logger.error(`💥 Attempt ${attempt} crashed: ${err.message}`);

      await notifyVoteFailed({
        error: err.message,
        strategy: config.voteStrategy,
        attempt,
        maxAttempts: config.maxRetries,
        willRetry: attempt < config.maxRetries,
      });
    } finally {
      try {
        await browser.close();
      } catch {
        // Browser might already be closed
      }
    }

    // Wait before retry (exponential backoff)
    if (attempt < config.maxRetries) {
      const delay = config.retryDelay * attempt;
      logger.info(`⏳ Waiting ${delay / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error(`❌ All ${config.maxRetries} attempts failed. Last error: ${lastError}`);
}

/**
 * Start the cron scheduler
 */
export async function startScheduler() {
  const schedule = config.cronSchedule;

  // Validate cron expression
  if (!cron.validate(schedule)) {
    logger.error(`❌ Invalid cron schedule: "${schedule}"`);
    process.exit(1);
  }

  logSeparator();
  logger.info('🤖 ═══════════════════════════════════════');
  logger.info('🤖  EDEL RUNWAY DESK - AUTO VOTE BOT');
  logger.info('🤖 ═══════════════════════════════════════');
  logger.info('');
  logger.info(`📅 Schedule: ${schedule}`);
  logger.info(`🎯 Strategy: ${config.voteStrategy}`);
  logger.info(`🖥️  Headless: ${config.headless}`);
  logger.info(`🔄 Max retries: ${config.maxRetries}`);
  logger.info(`📸 Screenshots: ${config.saveScreenshots}`);
  logger.info(`📨 Telegram: ${config.telegramBotToken ? 'Configured ✅' : 'Not configured ⚠️'}`);
  logger.info('');

  // Send Telegram notification that bot started
  await notifyBotStarted();

  logger.info('▶️  Running initial vote cycle...');
  await voteCycle();

  logger.info('');
  logger.info('⏳ Waiting for next scheduled run...');
  logger.info(`   (Schedule: "${schedule}")`);

  // Schedule recurring runs
  const job = cron.schedule(schedule, async () => {
    try {
      await voteCycle();
    } catch (err) {
      logger.error(`Scheduled vote cycle error: ${err.message}`);
    }
  }, {
    timezone: 'Asia/Jakarta',
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('');
    logger.info('🛑 Bot stopping...');
    job.stop();
    await sendTelegramShutdown();
    logger.info('👋 Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return job;
}

/**
 * Send bot shutdown notification
 */
async function sendTelegramShutdown() {
  const { sendTelegram } = await import('../utils/telegram.js');
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  await sendTelegram(`🛑 *BOT STOPPED*\n\n🕐 Waktu: ${time}`);
}

/**
 * Run a single vote (no scheduling)
 */
export async function runSingleVote() {
  logSeparator();
  logger.info('🗳️  Running single vote...');
  await voteCycle();
  logger.info('✅ Single vote cycle complete.');
}
