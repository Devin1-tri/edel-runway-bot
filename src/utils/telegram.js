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
    `🕐 Waktu: ${time}`,
    details.note ? `📝 Note: ${details.note}` : '',
    '',
    `⏰ Vote selanjutnya dalam ~1 jam`,
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
    `🕐 Waktu: ${time}`,
    `🔄 Attempt: ${details.attempt || '?'}/${details.maxAttempts || '?'}`,
    '',
    details.willRetry ? '⏳ Akan retry...' : '🛑 Semua retry gagal.',
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
    'Session login sudah expired.',
    'Perlu login ulang dengan passkey.',
    '',
    'Jalankan: `npm run setup`',
    'Lalu restart bot.',
  ].join('\n');

  return sendTelegram(msg);
}

/**
 * Notify bot started
 */
export async function notifyBotStarted() {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const msg = [
    '🤖 *BOT STARTED*',
    '',
    `🎯 Strategy: \`${config.voteStrategy}\``,
    `📅 Schedule: \`${config.cronSchedule}\``,
    `🕐 Started: ${time}`,
    '',
    'Bot akan vote otomatis setiap 1 jam.',
  ].join('\n');

  return sendTelegram(msg);
}

/**
 * Notify next vote scheduled
 */
export async function notifyNextVote() {
  const now = new Date();
  // Approximate next run (1 hour from now)
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  const nextStr = next.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const msg = [
    '⏰ *NEXT VOTE SCHEDULED*',
    '',
    `🕐 Estimasi vote selanjutnya: ${nextStr}`,
    '📡 Bot tetap berjalan...',
  ].join('\n');

  return sendTelegram(msg, { silent: true });
}

/**
 * Notify already voted
 */
export async function notifyAlreadyVoted(message) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const msg = [
    'ℹ️ *SUDAH VOTED*',
    '',
    `📝 Status: ${message || 'Already voted'}`,
    `🕐 Waktu cek: ${time}`,
    '',
    '⏰ Akan coba lagi di jadwal berikutnya.',
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
