import { validateConfig } from './utils/config.js';
import config from './utils/config.js';
import logger, { logSeparator } from './utils/logger.js';
import { hasSession, getSessionAge, clearSession, importSession, importSessionFromFile } from './auth/session.js';
import { checkSession } from './api/client.js';
import { startScheduler, runSingleVote } from './scheduler/cron.js';

// Get CLI command
const command = process.argv[2] || 'help';
const extraArg = process.argv[3] || null;

/**
 * Print usage help
 */
function printHelp() {
  console.log(`
\x1b[96m\x1b[1m  EDEL BOT \x1b[0m\x1b[90m─\x1b[0m\x1b[37m AUTO VOTE\x1b[0m
\x1b[90m  Created by Batokdrgn | HCA\x1b[0m
\x1b[35m  ════════════════════════════════════════════════\x1b[0m

Usage: node src/index.js <command>

Commands:
  import    ⭐ Import session from Chrome DevTools
            Login di Chrome → F12 → Network → copy Cookie → paste.

  import-file <path>
            Import session from JSON file.

  vote      Single vote (no scheduling)

  start     Start bot scheduler (auto vote + dynamic scheduling)
            Runs continuously until stopped (Ctrl+C)

  status    Check session and config status

  clear     Hapus session (force re-import)

  help      Show this help message

NPM Shortcuts:
  npm run import    → import session from Chrome
  npm run vote      → single vote
  npm run start     → start bot scheduler

Workflow:
  1. Login di Chrome → F12 → Network → copy Cookie
  2. Di VPS: npm run import → paste cookie
  3. Di VPS: npm run vote (test)
  4. Di VPS: npm run start (jalankan bot)

💡 This bot does NOT require Chrome/browser on the VPS!
`);
}

/**
 * Show current bot status
 */
async function showStatus() {
  logSeparator();
  logger.info('📊 Bot Status');
  logSeparator();

  // Session status
  if (hasSession()) {
    const age = getSessionAge();
    const ageStr = age !== null ? `${age.toFixed(1)} hours` : 'unknown';

    // Test if session is actually valid
    logger.info('🔍 Testing session...');
    const valid = await checkSession();

    if (valid) {
      logger.info(`✅ Session: Valid (age: ${ageStr})`);
    } else {
      logger.warn(`⚠️  Session: Expired/Invalid (age: ${ageStr})`);
      logger.info('   Run "npm run import" to re-import.');
    }
  } else {
    logger.error('❌ Session: Not found');
    logger.info('   Run "npm run import" to import from Chrome.');
  }

  // Config
  logger.info('');
  logger.info('⚙️  Configuration:');
  logger.info(`   Strategy:    ${config.voteStrategy}`);
  logger.info(`   Schedule:    ${config.cronSchedule}`);
  logger.info(`   Max Retries: ${config.maxRetries}`);
  logger.info(`   Base URL:    ${config.baseUrl}`);
  logger.info(`   Telegram:    ${config.telegramBotToken ? 'Configured ✅' : 'Not set ⚠️'}`);
  logger.info(`   Mode:        Pure HTTP (no browser)`);
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

      case 'vote':
        await runSingleVote();
        break;

      case 'start':
        await startScheduler();
        break;

      case 'status':
        await showStatus();
        break;

      case 'clear':
        clearSession();
        logger.info('Session cleared. Run "npm run import" to re-import.');
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
