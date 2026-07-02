import fs from 'fs';
import path from 'path';
import readline from 'readline';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Ensure session directory exists
 */
function ensureSessionDir() {
  if (!fs.existsSync(config.sessionDir)) {
    fs.mkdirSync(config.sessionDir, { recursive: true });
  }
}

/**
 * Save browser storage state (cookies, localStorage, etc.) to disk
 * @param {import('playwright').BrowserContext} context - Playwright browser context
 */
export async function saveSession(context) {
  ensureSessionDir();
  const state = await context.storageState();
  fs.writeFileSync(config.sessionFile, JSON.stringify(state, null, 2), 'utf-8');
  logger.info(`💾 Session saved to ${config.sessionFile}`);
  return state;
}

/**
 * Save raw session state object to disk
 * @param {object} state - Storage state object
 */
export function saveSessionRaw(state) {
  ensureSessionDir();
  fs.writeFileSync(config.sessionFile, JSON.stringify(state, null, 2), 'utf-8');
  logger.info(`💾 Session saved to ${config.sessionFile}`);
}

/**
 * Load saved session state from disk
 * @returns {object|null} Storage state object or null if not found
 */
export function loadSession() {
  if (!fs.existsSync(config.sessionFile)) {
    logger.warn('⚠️  No saved session found.');
    return null;
  }

  try {
    const data = fs.readFileSync(config.sessionFile, 'utf-8');
    const state = JSON.parse(data);
    logger.info('📂 Session loaded from disk.');
    return state;
  } catch (err) {
    logger.error(`Failed to load session: ${err.message}`);
    return null;
  }
}

/**
 * Check if a saved session exists
 */
export function hasSession() {
  return fs.existsSync(config.sessionFile);
}

/**
 * Delete saved session
 */
export function clearSession() {
  if (fs.existsSync(config.sessionFile)) {
    fs.unlinkSync(config.sessionFile);
    logger.info('🗑️  Session cleared.');
  }
}

/**
 * Get session age in hours
 */
export function getSessionAge() {
  if (!fs.existsSync(config.sessionFile)) return null;
  const stats = fs.statSync(config.sessionFile);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs / (1000 * 60 * 60);
}

/**
 * Check if session might be expired (older than 48 hours)
 */
export function isSessionLikelyExpired() {
  const age = getSessionAge();
  if (age === null) return true;
  return age > 48;
}

// ─────────────────────────────────────────────
//  Helper: ask a question in terminal
// ─────────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─────────────────────────────────────────────
//  Parse raw "Cookie:" header string into array
//  Input:  "name1=value1; name2=value2; ..."
//  Output: [{name, value, domain, path, ...}]
// ─────────────────────────────────────────────
function parseCookieString(cookieStr, domain = 'runway.edel.finance') {
  const cookies = [];
  // Remove "Cookie: " prefix if present
  const cleaned = cookieStr.replace(/^Cookie:\s*/i, '').trim();
  const pairs = cleaned.split(/;\s*/);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    if (!name) continue;

    cookies.push({
      name,
      value,
      domain,
      path: '/',
      expires: Date.now() / 1000 + 86400 * 30, // 30 days
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    });
  }
  return cookies;
}

// ─────────────────────────────────────────────
//  Build Playwright-compatible state from input
// ─────────────────────────────────────────────
function buildState(cookies) {
  return {
    cookies,
    origins: [
      {
        origin: 'https://runway.edel.finance',
        localStorage: [],
      },
    ],
  };
}

// ─────────────────────────────────────────────
//  IMPORT: Main function
// ─────────────────────────────────────────────
export async function importSession() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         🔐 IMPORT SESSION LOGIN                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  How to get Cookie from Chrome:');
  console.log('');
  console.log('  1. Open Chrome → login to https://runway.edel.finance');
  console.log('  2. Once logged in, open /listing-calls');
  console.log('  3. Press F12 (DevTools) → click "Network" tab');
  console.log('  4. Refresh the page (Ctrl+R)');
  console.log('  5. Click the first request in the list');
  console.log('  6. In the right panel, find "Request Headers"');
  console.log('  7. Find the "Cookie:" line');
  console.log('  8. Right-click the value → Copy value');
  console.log('  9. Paste below (ALL of it, length is fine)');
  console.log('');
  console.log('  The important part is: edel_session=eyJ...');
  console.log('');

  const input = await ask('📋 Paste Cookie > ');

  if (!input) {
    logger.error('❌ Tidak ada data.');
    return false;
  }

  // Detect what format the user pasted
  let cookies = [];

  if (input.includes('=') && (input.includes(';') || input.startsWith('edel_session='))) {
    // User pasted full cookie string or just edel_session=xxx
    cookies = parseCookieString(input);
  } else if (input.startsWith('eyJ')) {
    // User pasted just the JWT token value (starts with eyJ = base64 {"v"...)
    logger.info('🔍 Detected raw JWT token, wrapping as edel_session cookie...');
    cookies = [
      {
        name: 'edel_session',
        value: input,
        domain: 'runway.edel.finance',
        path: '/',
        expires: Date.now() / 1000 + 86400 * 30,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ];
  } else {
    // Try parsing as cookie string anyway
    cookies = parseCookieString(input);
  }

  if (cookies.length === 0) {
    logger.error('❌ Failed to parse cookies.');
    logger.info('   Correct format: name1=value1; name2=value2; ...');
    logger.info('   Or paste the token directly starting with eyJ...');
    return false;
  }

  // Check if edel_session is present
  const hasEdel = cookies.some((c) => c.name === 'edel_session');
  if (!hasEdel) {
    logger.warn('⚠️  Cookie "edel_session" not found!');
    logger.warn('   Make sure you are LOGGED IN before copying the cookie.');
    logger.warn('   Cookies found:');
    cookies.forEach((c) => logger.warn(`     - ${c.name}`));

    const proceed = await ask('Continue without edel_session? [y/N] > ');
    if (proceed.toLowerCase() !== 'y') {
      logger.info('Cancelled. Login first, then try again.');
      return false;
    }
  }

  // Save
  const state = buildState(cookies);
  saveSessionRaw(state);

  console.log('');
  logger.info('✅ Session imported successfully!');
  logger.info(`   🍪 ${cookies.length} cookies saved`);
  if (hasEdel) {
    logger.info('   🔑 edel_session ✓ (JWT token found)');
  }
  console.log('');
  logger.info('Now run:');
  logger.info('   npm run vote    → test single vote');
  logger.info('   npm run start   → start bot scheduler');
  return true;
}

// ─────────────────────────────────────────────
//  IMPORT: From JSON file
// ─────────────────────────────────────────────
export function importSessionFromFile(filePath) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    logger.error(`❌ File not found: ${absPath}`);
    return false;
  }

  try {
    const data = fs.readFileSync(absPath, 'utf-8');
    const state = JSON.parse(data);

    if (!state.cookies || !state.origins) {
      logger.error('❌ Invalid file format. Must have "cookies" and "origins".');
      return false;
    }

    saveSessionRaw(state);

    const cookieCount = state.cookies.length;
    const lsCount = state.origins[0]?.localStorage?.length || 0;

    logger.info('✅ Session imported successfully from file!');
    logger.info(`   🍪 ${cookieCount} cookies, 📦 ${lsCount} localStorage items`);
    return true;
  } catch (err) {
    logger.error(`❌ Gagal import: ${err.message}`);
    return false;
  }
}
