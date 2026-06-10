import { validateConfig } from './utils/config.js';
import config from './utils/config.js';
import logger, { logSeparator } from './utils/logger.js';
import { setupLogin } from './auth/login.js';
import { hasSession, getSessionAge, clearSession } from './auth/session.js';
import { startScheduler, runSingleVote } from './scheduler/cron.js';

// Get CLI command
const command = process.argv[2] || 'help';

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
  setup     Login interaktif (buka browser, login passkey manual)
            Simpan session untuk digunakan bot.

  vote      Vote sekali saja (tanpa scheduling)

  start     Mulai bot dengan cron scheduler (setiap 1 jam)
            Bot akan berjalan terus sampai dihentikan (Ctrl+C)

  status    Cek status session dan konfigurasi

  clear     Hapus session tersimpan (force re-login)

  help      Tampilkan bantuan ini

NPM Shortcuts:
  npm run setup     → node src/index.js setup
  npm run vote      → node src/index.js vote
  npm run start     → node src/index.js start

Environment:
  Copy .env.example ke .env dan sesuaikan konfigurasi.
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
      logger.warn('   Session mungkin sudah expired. Jalankan "npm run setup" untuk refresh.');
    }
  } else {
    logger.error('❌ Session: Belum ada');
    logger.info('   Jalankan "npm run setup" untuk login.');
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
      case 'setup':
        await setupLogin();
        break;

      case 'vote':
        await runSingleVote();
        break;

      case 'start':
        startScheduler();
        break;

      case 'status':
        showStatus();
        break;

      case 'clear':
        clearSession();
        logger.info('Session berhasil dihapus. Jalankan "npm run setup" untuk login ulang.');
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
