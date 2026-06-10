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
//  IMPORT METHOD: Cookie string from DevTools
// ─────────────────────────────────────────────
/**
 * Import session by pasting the Cookie header value from Chrome DevTools Network tab.
 *
 * How to get it:
 *   1. Login di Chrome
 *   2. F12 → Network tab
 *   3. Refresh halaman / klik halaman apapun
 *   4. Klik salah satu request ke "runway.edel.finance"
 *   5. Scroll ke "Request Headers" → cari "Cookie:"
 *   6. Klik kanan value-nya → Copy value
 *   7. Paste di sini
 */
export async function importFromCookieString() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   🍪 IMPORT SESSION DARI CHROME (Cookie Header)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Cara ambil Cookie dari Chrome:');
  console.log('');
  console.log('  1. Buka Chrome → login ke https://runway.edel.finance');
  console.log('  2. Setelah login, buka halaman /listing-calls');
  console.log('  3. Tekan F12 (DevTools)');
  console.log('  4. Klik tab "Network"');
  console.log('  5. Refresh halaman (Ctrl+R)');
  console.log('  6. Klik request pertama (biasanya "listing-calls")');
  console.log('  7. Di panel kanan, scroll ke "Request Headers"');
  console.log('  8. Cari baris "Cookie:" → klik kanan → Copy value');
  console.log('  9. Paste di bawah ini');
  console.log('');

  const cookieStr = await ask('📋 Paste Cookie value > ');

  if (!cookieStr) {
    logger.error('❌ Tidak ada data.');
    return false;
  }

  const cookies = parseCookieString(cookieStr);

  if (cookies.length === 0) {
    logger.error('❌ Gagal parse cookies. Pastikan format: name1=value1; name2=value2');
    return false;
  }

  // Now ask for localStorage (Privy tokens)
  console.log('');
  console.log('─'.repeat(58));
  console.log('');
  console.log('Sekarang kita perlu ambil data Privy (localStorage):');
  console.log('');
  console.log('  1. Masih di F12, klik tab "Application"');
  console.log('  2. Di sidebar kiri, klik "Local Storage"');
  console.log('     → klik "https://runway.edel.finance"');
  console.log('  3. Kamu akan lihat daftar Key-Value');
  console.log('  4. Cari key yang mengandung "privy" atau "auth"');
  console.log('     (biasanya: privy:token, privy:session, dll)');
  console.log('');
  console.log('  Caranya: klik satu-satu pada key yg mengandung');
  console.log('  "privy", copy Value-nya (klik kanan → Copy value)');
  console.log('');
  console.log('  Atau kalau mau skip (cookies saja), tekan Enter kosong.');
  console.log('');

  const localStorageItems = [];
  let keepAsking = true;
  let itemNum = 1;

  while (keepAsking) {
    const key = await ask(`  Key ${itemNum} (atau Enter untuk selesai) > `);
    if (!key) {
      keepAsking = false;
      break;
    }
    const value = await ask(`  Value ${itemNum} > `);
    if (value) {
      localStorageItems.push({ name: key, value });
      logger.info(`   ✓ Saved: ${key}`);
      itemNum++;
    }
  }

  // Build Playwright-compatible state
  const state = {
    cookies,
    origins: [
      {
        origin: 'https://runway.edel.finance',
        localStorage: localStorageItems,
      },
    ],
  };

  saveSessionRaw(state);

  console.log('');
  logger.info('✅ Session berhasil di-import!');
  logger.info(`   🍪 ${cookies.length} cookies`);
  logger.info(`   📦 ${localStorageItems.length} localStorage items`);
  console.log('');
  logger.info('Sekarang jalankan:');
  logger.info('   npm run vote    → test vote sekali');
  logger.info('   npm run start   → mulai bot scheduler');
  return true;
}

// ─────────────────────────────────────────────
//  IMPORT METHOD: JSON file (scp dari PC)
// ─────────────────────────────────────────────
/**
 * Import session from a JSON file.
 * The file can be:
 *   - Playwright storage state exported from "npm run setup"
 *   - Or manually created JSON with cookies + origins
 */
export function importSessionFromFile(filePath) {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    logger.error(`❌ File tidak ditemukan: ${absPath}`);
    return false;
  }

  try {
    const data = fs.readFileSync(absPath, 'utf-8');
    const state = JSON.parse(data);

    if (!state.cookies || !state.origins) {
      logger.error('❌ Format file tidak valid. Harus punya "cookies" dan "origins".');
      return false;
    }

    saveSessionRaw(state);

    const cookieCount = state.cookies.length;
    const lsCount = state.origins[0]?.localStorage?.length || 0;

    logger.info('✅ Session berhasil di-import dari file!');
    logger.info(`   🍪 ${cookieCount} cookies, 📦 ${lsCount} localStorage items`);
    return true;
  } catch (err) {
    logger.error(`❌ Gagal import: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────
//  MAIN IMPORT MENU
// ─────────────────────────────────────────────
export async function importSession() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         🔐 IMPORT SESSION LOGIN                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Pilih cara import session:');
  console.log('');
  console.log('  1. 🍪 Dari Chrome DevTools (copy Cookie header)');
  console.log('     → Login di Chrome, F12, copy cookie, paste di sini');
  console.log('');
  console.log('  2. 📁 Dari file JSON (scp dari PC)');
  console.log('     → Kalau sudah punya file session.json');
  console.log('');

  const choice = await ask('Pilih [1/2] > ');

  switch (choice) {
    case '1':
      return importFromCookieString();

    case '2': {
      const filePath = await ask('Path ke file JSON > ');
      return importSessionFromFile(filePath);
    }

    default:
      logger.info('Pilihan tidak valid. Gunakan 1 atau 2.');
      return false;
  }
}
