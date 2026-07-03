import { validateConfig } from './utils/config.js';
import config from './utils/config.js';
import logger, { logSeparator } from './utils/logger.js';
import { hasSession, getSessionAge, clearSession, importSession, importSessionFromFile } from './auth/session.js';
import { checkSession } from './api/client.js';
import { startScheduler, runSingleVote } from './scheduler/cron.js';
import {
  getAccounts,
  getEnabledAccounts,
  addAccount,
  removeAccount,
  enableAccount,
  disableAccount,
  getAccount,
  getAccountCount,
  initDefaultAccount,
} from './accounts/manager.js';

// Get CLI command
const command = process.argv[2] || 'help';
const extraArg = process.argv[3] || null;
const extraArg2 = process.argv[4] || null;

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
  import          🔐 Import session from Chrome DevTools
                  (legacy single-account, use add-account for multi)

  import-file <path>
                  Import session from JSON file.

  vote            Single vote for all accounts (no scheduling)

  start           Start bot scheduler (auto vote + dynamic scheduling)
                  Runs continuously until stopped (Ctrl+C)

  status          Check session and config status

  accounts        List all configured accounts

  add-account [id] [label]
                  Add a new account (e.g. add-account A1 Main)

  remove-account <id>
                  Remove an account

  enable <id>     Enable an account

  disable <id>    Disable an account

  clear           Clear session (force re-import)

  help            Show this help message

NPM Shortcuts:
  npm run import        → import session from Chrome
  npm run vote          → single vote for all accounts
  npm run start         → start bot scheduler

Multi-Account Workflow:
  1. node src/index.js add-account A1 "Main Account"
  2. node src/index.js add-account A2 "Second Account"
  3. Import session for each account (copy cookie → save to sessions/A1.json, etc.)
  4. node src/index.js start
`);
}

async function main() {
  try {
    validateConfig();
  } catch (err) {
    console.error(`\x1b[31m❌ Config error: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  switch (command) {
    case 'import':
      await importSession();
      break;

    case 'import-file':
      if (!extraArg) {
        console.error('❌ Usage: import-file <path>');
        process.exit(1);
      }
      await importSessionFromFile(extraArg);
      break;

    case 'vote':
      await runSingleVote();
      break;

    case 'start':
      await startScheduler();
      break;

    case 'status': {
      // Migrate if needed
      initDefaultAccount();

      const accounts = getAccounts();
      if (accounts.length > 0) {
        console.log(`\n👥 Accounts: ${accounts.length}`);
        for (const acc of accounts) {
          const icon = acc.enabled ? '✅' : '⏸️';
          const status = acc.lastVoteStatus || 'never';
          console.log(`  ${icon} ${acc.id} (${acc.label}): last=${status}`);
        }
      } else if (hasSession()) {
        const age = getSessionAge();
        const ageStr = age !== null ? `${age.toFixed(1)} hours` : 'unknown';
        logger.info('🔍 Testing session...');
        const valid = await checkSession();
        if (valid) {
          console.log(`✅ Session: Valid (age: ${ageStr})`);
        } else {
          console.warn(`⚠️  Session: Expired/Invalid (age: ${ageStr})`);
        }
      } else {
        console.error('❌ No accounts configured. Run: add-account');
      }
      break;
    }

    case 'accounts': {
      initDefaultAccount();
      const accounts = getAccounts();
      if (accounts.length === 0) {
        console.log('\n⚠️  No accounts configured.');
        console.log('   Run: node src/index.js add-account A1 "My Account"\n');
      } else {
        console.log(`\n👥 Accounts (${accounts.length}):\n`);
        for (const acc of accounts) {
          const statusIcon = acc.enabled ? '✅' : '⏸️';
          const lastStatus = acc.lastVoteStatus || 'never voted';
          const lastTime = acc.lastVote
            ? new Date(acc.lastVote).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            : 'never';
          console.log(`  ${statusIcon} ${acc.id.padEnd(4)} │ ${acc.label.padEnd(20)} │ ${lastStatus.padEnd(12)} │ ${lastTime}`);
        }
        console.log('');
      }
      break;
    }

    case 'add-account': {
      initDefaultAccount();
      const id = extraArg || undefined;
      const label = extraArg2 || '';
      const account = addAccount(id, label);
      console.log(`\n✅ Account added: ${account.id} (${account.label || account.id})`);
      console.log(`   Session file: ${account.sessionFile}`);
      console.log(`\n   Next: import session cookie for this account.\n`);
      break;
    }

    case 'remove-account': {
      if (!extraArg) {
        console.error('❌ Usage: remove-account <id>');
        process.exit(1);
      }
      const removed = removeAccount(extraArg);
      console.log(`\n✅ Account removed: ${removed.id}\n`);
      break;
    }

    case 'enable': {
      if (!extraArg) {
        console.error('❌ Usage: enable <id>');
        process.exit(1);
      }
      enableAccount(extraArg);
      console.log(`✅ Account ${extraArg} enabled.`);
      break;
    }

    case 'disable': {
      if (!extraArg) {
        console.error('❌ Usage: disable <id>');
        process.exit(1);
      }
      disableAccount(extraArg);
      console.log(`✅ Account ${extraArg} disabled.`);
      break;
    }

    case 'clear':
      clearSession();
      logger.info('Session cleared. Run "npm run import" to re-import.');
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`\x1b[31m❌ Fatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
