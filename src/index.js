import { validateConfig } from './utils/config.js';
import config from './utils/config.js';
import logger, { logSeparator } from './utils/logger.js';
import { setupLogin } from './auth/login.js';
import { hasSession, getSessionAge, clearSession, importSession, importSessionFromFile } from './auth/session.js';
import { startScheduler, runSingleVote } from './scheduler/cron.js';

// Get CLI command
const command = process.argv[2] || 'help';
const extraArg = process.argv[3] || null;

/**
 * Print usage help
 */
function printHelp() {
  console.log(`
╔═══════════════════════════════════════════════════╗
║     🤖 EDEL RUNWAY DESK - AUTO VOTE BOT 🤖      ║
╚═══════════════════════════════════════════════════╝

Usage: node src/index.js <command>

Commands:
  import    ⭐ Import session dari Chrome DevTools (RECOMMENDED)
            Login di Chrome PC kamu → F12 → copy Cookie → paste di sini.
            Tidak perlu jalankan browser di VPS.

  import-file <path>
            Import session dari file JSON.
            Contoh: node src/index.js import-file ./session.json

  setup     Login interaktif via Playwright (butuh GUI/Desktop)
            Buka browser, login passkey manual, session auto-save.

  vote      Vote sekali saja (tanpa scheduling)

  start     Mulai bot dengan cron scheduler (default: setiap 1 jam)
            Bot akan berjalan terus sampai dihentikan (Ctrl+C)

  status    Cek status session dan konfigurasi

  clear     Hapus session tersimpan (force re-login)

  help      Tampilkan bantuan ini

NPM Shortcuts:
  npm run import    → import session dari Chrome
  npm run setup     → login interaktif (butuh GUI)
  npm run vote      → vote sekali
  npm run start     → mulai bot scheduler

Workflow untuk VPS:
  1. Login di Chrome PC → F12 → copy cookie
  2. Di VPS: npm run import → paste cookie
  3. Di VPS: npm run vote (test dulu)
  4. Di VPS: npm run start (jalankan bot)
`);
}

/**
 * Show current bot status
 */
function showStatus() {
  logSeparator();
  logger.info('📊 Bot Status');
  logSeparator();

  // Session status
  if (hasSession()) {
    const age = getSessionAge();
    const ageStr = age !== null ? `${age.toFixed(1)} jam` : 'unknown';
    const fresh = age !== null && age < 48;
    const icon = fresh ? '✅' : '⚠️';
    logger.info(`${icon} Session: Tersimpan (umur: ${ageStr})`);
    if (!fresh) {
      logger.warn('   Session mungkin sudah expired. Jalankan "npm run import" untuk refresh.');
    }
  } else {
    logger.error('❌ Session: Belum ada');
    logger.info('   Jalankan "npm run import" untuk import dari Chrome.');
  }

  // Config
  logger.info('');
  logger.info('⚙️  Configuration:');
  logger.info(`   Strategy:    ${config.voteStrategy}`);
  logger.info(`   Schedule:    ${config.cronSchedule}`);
  logger.info(`   Headless:    ${config.headless}`);
  logger.info(`   Screenshots: ${config.saveScreenshots}`);
  logger.info(`   Max Retries: ${config.maxRetries}`);
  logger.info(`   Base URL:    ${config.baseUrl}`);
  logger.info(`   Telegram:    ${config.telegramBotToken ? 'Configured ✅' : 'Not set ⚠️'}`);
  logSeparator();
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Validate config (except for help command)
    if (command !== 'help') {
      validateConfig();
    }

    switch (command) {
      case 'import':
        await importSession();
        break;

      case 'import-file':
        if (!extraArg) {
          logger.error('❌ Perlu path ke file JSON.');
          logger.info('   Contoh: node src/index.js import-file ./session.json');
        } else {
          importSessionFromFile(extraArg);
        }
        break;

      case 'setup':
        await setupLogin();
        break;

      case 'vote':
        await runSingleVote();
        break;

      case 'start':
        await startScheduler();
        break;

      case 'status':
        showStatus();
        break;

      case 'clear':
        clearSession();
        logger.info('Session berhasil dihapus. Jalankan "npm run import" untuk import ulang.');
        break;

      case 'help':
      default:
        printHelp();
        break;
    }
  } catch (err) {
    logger.error(`Fatal error: ${err.message}`);
    logger.debug(err.stack);
    process.exit(1);
  }
}

main();
