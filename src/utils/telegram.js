import config from './config.js';
import logger from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Send a message via Telegram Bot API
 * Uses native fetch (Node.js 18+)
 * @param {string} text - Message text (supports Markdown)
 * @param {object} opts
 * @param {boolean} opts.silent - Send without notification sound
 */
export async function sendTelegram(text, { silent = false } = {}) {
  const { telegramBotToken, telegramChatId } = config;

  if (!telegramBotToken || !telegramChatId) {
    logger.debug('Telegram not configured, skipping notification.');
    return false;
  }

  try {
    const url = `${TELEGRAM_API}${telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text,
        parse_mode: 'Markdown',
        disable_notification: silent,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn(`Telegram API error (${res.status}): ${body}`);
      return false;
    }

    logger.debug('📨 Telegram notification sent.');
    return true;
  } catch (err) {
    logger.warn(`Telegram send failed: ${err.message}`);
    return false;
  }
}

/**
 * Notify vote success
 */
export async function notifyVoteSuccess(details = {}) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const msg = [
    '✅ *VOTE BERHASIL*',
    '',
    `🗳️ Asset: *${details.asset || 'N/A'}*`,
    `🎯 Strategy: \`${details.strategy || 'N/A'}\``,
    `📅 Round: ${details.round || 'N/A'}`,
    `🕐 Time: ${time}`,
    details.note ? `📝 Note: ${details.note}` : '',
  ].filter(Boolean).join('\n');

  return sendTelegram(msg);
}

/**
 * Notify vote failed
 */
export async function notifyVoteFailed(details = {}) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const msg = [
    '❌ *VOTE GAGAL*',
    '',
    `⚠️ Error: ${details.error || 'Unknown'}`,
    `🎯 Strategy: \`${details.strategy || 'N/A'}\``,
    `🕐 Time: ${time}`,
    `🔄 Attempt: ${details.attempt || '?'}/${details.maxAttempts || '?'}`,
    '',
    details.willRetry ? '⏳ Retrying...' : '🛑 All retries failed.',
  ].join('\n');

  return sendTelegram(msg);
}

/**
 * Notify session expired
 */
export async function notifySessionExpired() {
  const msg = [
    '🔑 *SESSION EXPIRED*',
    '',
    'Login session has expired.',
    '',
    '*How to update (directly here):*',
    '1. Open Chrome → login https://runway.edel.finance',
    '2. Press F12 → Network → Refresh page',
    '3. Click first request → find Cookie header',
    '4. Copy the cookie value',
    '5. *Paste directly in this chat* ⬇️',
    '',
    '💡 You can paste:',
    '• `edel_session=eyJ...;cookie2=xxx`',
    '• atau JWT saja: `eyJhbGci...`',
    '',
    '📱 Bot is waiting for your cookie...',
  ].join('\n');

  return sendTelegram(msg);
}

/**
 * Notify bot started
 */
export async function notifyBotStarted() {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const totalMin = config.voteIntervalMinutes + config.voteBufferMinutes;
  const msg = [
    '🤖 *BOT STARTED*',
    '',
    `🎯 Strategy: \`${config.voteStrategy}\``,
    `📅 Interval: ${config.voteIntervalMinutes} min + ${config.voteBufferMinutes} min buffer = ${totalMin} min`,
    `🔄 Retry: every ${config.retryIntervalMinutes} min (if not ready)`,
    `🕐 Started: ${time}`,
    '',
    'Bot will vote automatically with dynamic scheduling.',
  ].join('\n');

  return sendTelegram(msg);
}

/**
 * Notify next vote scheduled
 */
export async function notifyNextVote(nextTime) {
  const nextStr = nextTime
    ? nextTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    : 'Unknown';

  const now = new Date();
  const diffMs = nextTime ? nextTime.getTime() - now.getTime() : 0;
  const diffMin = Math.round(diffMs / 60000);

  const msg = [
    '⏰ *NEXT VOTE SCHEDULED*',
    '',
    `🕐 Next vote: ${nextStr}`,
    `⏳ In ${diffMin} minutes`,
    '📡 Bot continues running...',
  ].join('\n');

  return sendTelegram(msg, { silent: true });
}

/**
 * Notify already voted
 */
export async function notifyAlreadyVoted(message) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const msg = [
    'ℹ️ *ALREADY VOTED*',
    '',
    `📝 Status: ${message || 'Already voted'}`,
    `🕐 Check time: ${time}`,
    '',
    '⏰ Will retry at the next scheduled time.',
  ].join('\n');

  return sendTelegram(msg, { silent: true });
}

export default {
  sendTelegram,
  notifyVoteSuccess,
  notifyVoteFailed,
  notifySessionExpired,
  notifyBotStarted,
  notifyNextVote,
  notifyAlreadyVoted,
};
