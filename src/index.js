import { validateConfig } from './utils/config.js';
import config from './utils/config.js';
import logger, { logSeparator } from './utils/logger.js';
import { startScheduler, runSingleVote } from './scheduler/cron.js';
import {
  getAccounts,
  getEnabledAccounts,
  getAccountCount,
  enableAccount,
  disableAccount,
  hasAccountSession,
  saveAccountSession,
  initDefaultAccount,
} from './accounts/manager.js';
import readline from 'readline';

const command = process.argv[2] || 'help';
const extraArg = process.argv[3] || null;

function printHelp() {
  console.log(`
\x1b[96m\x1b[1m  EDEL BOT \x1b[0m\x1b[90m─\x1b[0m\x1b[37m AUTO VOTE\x1b[0m
\x1b[90m  Created by Batokdrgn | HCA\x1b[0m
\x1b[35m  ════════════════════════════════════════════════\x1b[0m

Usage: node src/index.js <command>

Commands:
  import    🔐 Import session for all accounts (interactive)
  vote      Single vote for all accounts (no scheduling)
  start     Start bot scheduler (auto vote + dynamic scheduling)
  status    Check accounts and session status
  accounts  List all configured accounts
  enable    Enable an account  (e.g. enable A2)
  disable   Disable an account (e.g. disable A1)
  help      Show this help message

NPM Shortcuts:
  npm run import    → import sessions for all accounts
  npm run vote      → single vote for all accounts
  npm run start     → start bot scheduler
  npm run accounts  → list accounts

Setup:
  1. Edit accounts.txt — add your accounts (one per line)
  2. npm run import — paste cookie for each account
  3. npm run start — run the bot
`);
}

/**
 * Parse cookie string into cookie objects.
 */
function parseCookies(input) {
  const raw = input.trim();
  // If it looks like a full cookie header: "name1=val1; name2=val2"
  if (raw.includes('=')) {
    return raw.split(';').map((pair) => {
      const [name, ...rest] = pair.trim().split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    }).filter((c) => c.name);
  }
  // If it looks like just a JWT
  if (raw.startsWith('eyJ')) {
    return [{ name: 'edel_session', value: raw }];
  }
  return [];
}

/**
 * Interactive import for all accounts.
 */
async function importAllAccounts() {
  const accounts = getAccounts();

  if (accounts.length === 0) {
    console.log('\n❌ No accounts configured!');
    console.log('   Edit accounts.txt and add your accounts:');
    console.log('   A1');
    console.log('   A2');
    console.log('   A3');
    console.log('');
    process.exit(1);
  }

  console.log(`\n🔐 Import session for ${accounts.length} account(s)\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  let imported = 0;
  for (const account of accounts) {
    const hasSession = hasAccountSession(account.id);
    const status = hasSession ? ' (has session)' : '';

    console.log(`📋 Paste cookie for ${account.id}${status}:`);
    console.log('   (edel_session=eyJ... or just the JWT token)');
    const input = await ask(`   > `);

    if (!input.trim()) {
      console.log(`   ⏭️  Skipped ${account.id}\n`);
      continue;
    }

    const cookies = parseCookies(input);
    if (cookies.length === 0) {
      console.log(`   ❌ Invalid cookie format. Skipped.\n`);
      continue;
    }

    const hasEdel = cookies.some((c) => c.name === 'edel_session');
    if (!hasEdel) {
      console.log(`   ⚠️  No edel_session cookie found. Saving anyway.`);
    }

    saveAccountSession(account.id, cookies);
    console.log(`   ✅ ${account.id} saved (${cookies.length} cookies)\n`);
    imported++;
  }

  rl.close();
  console.log(`✅ Done! ${imported}/${accounts.length} accounts imported.\n`);
}

/**
 * List accounts with status.
 */
function listAccounts() {
  initDefaultAccount();
  const accounts = getAccounts();

  if (accounts.length === 0) {
    console.log('\n⚠️  No accounts configured.');
    console.log('   Edit accounts.txt and add your accounts.\n');
    return;
  }

  console.log(`\n👥 Accounts (${accounts.length}):\n`);
  for (const acc of accounts) {
    const enabled = acc.enabled ? '✅' : '⏸️';
    const session = hasAccountSession(acc.id) ? '📦' : '❌';
    const status = acc.lastVoteStatus || 'never';
    console.log(`  ${enabled} ${session} ${acc.id.padEnd(4)} │ last: ${status}`);
  }
  console.log('\n  ✅=enabled ⏸️=disabled 📦=has session ❌=no session\n');
}

async function main() {
  try {
    validateConfig();
  } catch (err) {
    console.error(`\x1b[31m❌ Config error: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  // Auto-migrate legacy session
  initDefaultAccount();

  switch (command) {
    case 'import':
      await importAllAccounts();
      break;

    case 'vote':
      await runSingleVote();
      break;

    case 'start':
      await startScheduler();
      break;

    case 'status':
      listAccounts();
      break;

    case 'accounts':
      listAccounts();
      break;

    case 'enable': {
      if (!extraArg) {
        console.error('❌ Usage: enable <id> (e.g. enable A2)');
        process.exit(1);
      }
      enableAccount(extraArg);
      console.log(`✅ ${extraArg} enabled.`);
      break;
    }

    case 'disable': {
      if (!extraArg) {
        console.error('❌ Usage: disable <id> (e.g. disable A1)');
        process.exit(1);
      }
      disableAccount(extraArg);
      console.log(`✅ ${extraArg} disabled.`);
      break;
    }

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
