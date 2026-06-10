import { chromium } from 'playwright';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { saveSession, loadSession, hasSession, isSessionLikelyExpired } from './session.js';

/**
 * Launch a browser with optional saved session state
 * @param {object} opts
 * @param {boolean} opts.headed - Force headed mode (overrides config)
 * @param {object|null} opts.storageState - Saved storage state to restore
 * @returns {{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }}
 */
export async function launchBrowser({ headed = false, storageState = null } = {}) {
  const headless = headed ? false : config.headless;

  logger.info(`🌐 Launching browser (headless: ${headless}, slowMo: ${config.slowMo}ms)`);

  const browser = await chromium.launch({
    headless,
    slowMo: config.slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    ...(storageState ? { storageState } : {}),
  };

  const context = await browser.newContext(contextOptions);

  // Stealth: override navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(config.pageTimeout);

  return { browser, context, page };
}

/**
 * Interactive setup: opens browser for manual passkey login, then saves session.
 * User must complete the passkey authentication themselves.
 */
export async function setupLogin() {
  logger.info('🔐 Starting interactive login setup...');
  logger.info('📋 Steps:');
  logger.info('   1. Browser akan terbuka');
  logger.info('   2. Login dengan passkey kamu (fingerprint/PIN/security key)');
  logger.info('   3. Tunggu sampai masuk ke dashboard');
  logger.info('   4. Bot akan otomatis menyimpan session');
  logger.info('');

  const { browser, context, page } = await launchBrowser({ headed: true });

  try {
    // Navigate to login page
    await page.goto(config.loginUrl, { waitUntil: 'networkidle' });
    logger.info('📄 Halaman login terbuka. Silakan login dengan passkey...');

    // Wait for user to complete login and land on authenticated pages
    // We detect successful login by waiting for navigation away from auth pages
    // or by detecting the AppFrame/dashboard elements
    await page.waitForFunction(
      () => {
        const path = window.location.pathname;
        // User is logged in when they're no longer on auth pages
        return (
          path !== '/login' &&
          path !== '/register' &&
          path !== '/' &&
          !path.startsWith('/auth')
        );
      },
      { timeout: 300000 } // 5 minutes for user to login
    );

    // Small delay to let session fully establish
    await page.waitForTimeout(3000);

    // Verify we're on an authenticated page
    const currentUrl = page.url();
    logger.info(`✅ Login berhasil! Current page: ${currentUrl}`);

    // Save the session
    await saveSession(context);
    logger.info('💾 Session berhasil disimpan!');
    logger.info('');
    logger.info('🎉 Setup selesai! Sekarang kamu bisa jalankan:');
    logger.info('   npm run vote   → vote sekali');
    logger.info('   npm run start  → mulai bot scheduler');
  } catch (err) {
    if (err.name === 'TimeoutError') {
      logger.error('⏰ Timeout: Login tidak selesai dalam 5 menit.');
      logger.info('   Silakan coba lagi: npm run setup');
    } else {
      logger.error(`Login setup gagal: ${err.message}`);
    }
  } finally {
    await browser.close();
  }
}

/**
 * Get an authenticated browser session, either from saved state or interactive login.
 * @returns {{ browser, context, page }|null}
 */
export async function getAuthenticatedSession() {
  // Check if session exists
  if (!hasSession()) {
    logger.error('❌ Belum ada session tersimpan. Jalankan "npm run setup" dulu.');
    return null;
  }

  // Warn if session might be old
  if (isSessionLikelyExpired()) {
    logger.warn('⚠️  Session sudah cukup lama (>48 jam). Mungkin perlu login ulang.');
  }

  // Load saved session
  const storageState = loadSession();
  if (!storageState) {
    logger.error('❌ Gagal load session. Jalankan "npm run setup" ulang.');
    return null;
  }

  // Launch browser with saved session
  const { browser, context, page } = await launchBrowser({ storageState });

  // Verify session is still valid by navigating to the app
  try {
    await page.goto(config.listingCallsUrl, { waitUntil: 'networkidle', timeout: config.pageTimeout });

    // Check if we got redirected to login (session expired)
    const currentUrl = page.url();
    if (
      currentUrl.includes('/login') ||
      currentUrl.includes('/register') ||
      currentUrl === config.baseUrl + '/'
    ) {
      logger.error('❌ Session expired! Kamu perlu login ulang.');
      logger.info('   Jalankan: npm run setup');
      await browser.close();
      return null;
    }

    // Wait a bit for page to fully render
    await page.waitForTimeout(2000);
    logger.info(`✅ Session valid. Page: ${currentUrl}`);

    // Update saved session with fresh tokens
    await saveSession(context);

    return { browser, context, page };
  } catch (err) {
    logger.error(`❌ Session validation gagal: ${err.message}`);
    await browser.close();
    return null;
  }
}
