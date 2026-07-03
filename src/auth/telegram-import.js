/**
 * Telegram-based session import (multi-account).
 *
 * User can paste cookies in Telegram with account prefix:
 *   A1: edel_session=eyJ...
 *   A2: eyJhbGciOi...
 *
 * Without prefix → defaults to A1 (backward compatible).
 *
 * When SESSION_EXPIRED, bot asks for cookie via Telegram.
 * The cookie message is auto-deleted for security.
 */
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { saveAccountSession, getAccounts, hasAccountSession } from '../accounts/manager.js';
import { sendTelegram } from '../utils/telegram.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Parse cookie message with optional account prefix.
 *
 * Formats:
 *   "A1: edel_session=eyJ..." → { accountId: 'A1', cookies: [...] }
 *   "A2: eyJhbGciOi..."       → { accountId: 'A2', cookies: [...] }
 *   "edel_session=eyJ..."     → { accountId: 'A1', cookies: [...] } (default)
 *   "eyJhbGciOi..."           → { accountId: 'A1', cookies: [...] } (default)
 *
 * @param {string} text - Raw message text
 * @returns {{ accountId: string, cookies: Array } | null}
 */
function parseCookieMessage(text) {
  if (!text) return null;

  let cleaned = text.trim();

  // Ignore short messages and bot commands
  if (cleaned.length < 20) return null;
  if (cleaned.startsWith('/')) return null;

  // Check for account prefix: "A1: ..." or "A2: ..."
  let accountId = 'A1'; // default
  const prefixMatch = cleaned.match(/^(A\d+):\s*/i);
  if (prefixMatch) {
    accountId = prefixMatch[1].toUpperCase();
    cleaned = cleaned.substring(prefixMatch[0].length).trim();
  }

  // Parse cookies
  let cookies = [];

  if (cleaned.includes('edel_session=')) {
    // Full cookie string
    const raw = cleaned.replace(/^Cookie:\s*/i, '').trim();
    const pairs = raw.split(/;\s*/);

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (!name) continue;

      cookies.push({
        name,
        value,
        domain: 'runway.edel.finance',
        path: '/',
        expires: Date.now() / 1000 + 86400 * 30,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      });
    }

    if (!cookies.some((c) => c.name === 'edel_session')) {
      return null;
    }
  } else if (cleaned.startsWith('eyJ') && cleaned.length > 50 && !cleaned.includes(' ')) {
    // Just JWT token
    cookies = [{
      name: 'edel_session',
      value: cleaned,
      domain: 'runway.edel.finance',
      path: '/',
      expires: Date.now() / 1000 + 86400 * 30,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    }];
  } else {
    return null;
  }

  return { accountId, cookies };
}

// Persistent offset
let _telegramOffset = 0;
let _offsetInitialized = false;

/**
 * Poll Telegram for cookie messages from the user.
 *
 * @param {number} timeoutMinutes - Max time to wait
 * @param {string|null} expectedAccount - If set, only accept this account (e.g. 'A1')
 * @returns {{ accountId: string, cookies: Array } | null}
 */
export async function waitForCookieViaTelegram(timeoutMinutes = 60, expectedAccount = null) {
  const { telegramBotToken, telegramChatId } = config;

  if (!telegramBotToken || !telegramChatId) {
    logger.error('❌ Telegram not configured. Cannot wait for cookie.');
    return null;
  }

  const hint = expectedAccount
    ? `Paste cookie for ${expectedAccount}: ${expectedAccount}: edel_session=eyJ...`
    : 'Paste cookie: A1: edel_session=eyJ... (or without prefix for A1)';

  logger.info('📱 Waiting for cookie via Telegram...');
  logger.info(`   Format: ${hint}`);
  logger.info(`   Timeout: ${timeoutMinutes} minutes`);

  await sendTelegram(
    [
      '🔑 *SESSION EXPIRED*',
      '',
      'Paste new cookie to continue:',
      '',
      expectedAccount
        ? `\`${expectedAccount}: edel_session=eyJ...\``
        : '`A1: edel_session=eyJ...`',
      '',
      '💡 Prefix with account ID (A1:, A2:, etc.)',
      '   Without prefix → defaults to A1',
    ].join('\n')
  );

  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;

  // Skip old messages on first call
  if (!_offsetInitialized) {
    _offsetInitialized = true;
    try {
      const initUrl = `${TELEGRAM_API}${telegramBotToken}/getUpdates?offset=-1&limit=1`;
      const initRes = await fetch(initUrl);
      const initData = await initRes.json();
      if (initData.ok && initData.result.length > 0) {
        _telegramOffset = initData.result[initData.result.length - 1].update_id + 1;
      }
    } catch (e) {
      logger.debug(`Init offset error: ${e.message}`);
    }
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      const url = `${TELEGRAM_API}${telegramBotToken}/getUpdates?offset=${_telegramOffset}&timeout=30`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        logger.debug(`Telegram getUpdates error: ${JSON.stringify(data)}`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const update of data.result) {
        _telegramOffset = update.update_id + 1;
        const msg = update.message;

        if (!msg || !msg.text) continue;
        if (String(msg.chat.id) !== String(telegramChatId)) continue;

        const parsed = parseCookieMessage(msg.text);
        if (!parsed) continue;

        // If expected account, verify match
        if (expectedAccount && parsed.accountId !== expectedAccount) {
          logger.info(`   Got cookie for ${parsed.accountId}, expected ${expectedAccount}. Ignoring.`);
          continue;
        }

        // Verify account exists
        const accounts = getAccounts();
        const account = accounts.find((a) => a.id === parsed.accountId);
        if (!account) {
          await sendTelegram(`❌ Account *${parsed.accountId}* not found in accounts.txt`);
          continue;
        }

        // Save to account session
        saveAccountSession(parsed.accountId, parsed.cookies);

        const edelCookie = parsed.cookies.find((c) => c.name === 'edel_session');
        const tokenPreview = edelCookie
          ? `${edelCookie.value.substring(0, 20)}...`
          : 'N/A';

        logger.info(`🍪 ${parsed.accountId} cookie received via Telegram!`);
        logger.info(`   Token: ${tokenPreview}`);
        logger.info(`   ${parsed.cookies.length} cookies saved`);

        await sendTelegram(
          [
            `✅ *${parsed.accountId} SESSION UPDATED*`,
            '',
            `🍪 ${parsed.cookies.length} cookies saved`,
            `🔑 Token: \`${tokenPreview}\``,
            '',
            '▶️ Bot will continue voting...',
          ].join('\n')
        );

        // Delete cookie message for security
        try {
          await fetch(`${TELEGRAM_API}${telegramBotToken}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              message_id: msg.message_id,
            }),
          });
          logger.debug('🗑️ Cookie message deleted for security.');
        } catch (e) {
          logger.debug(`Could not delete cookie message: ${e.message}`);
        }

        return parsed;
      }
    } catch (err) {
      logger.debug(`Telegram poll error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  logger.warn(`⏰ Timeout (${timeoutMinutes} min) waiting for cookie via Telegram.`);
  return null;
}
