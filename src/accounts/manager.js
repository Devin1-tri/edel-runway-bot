/**
 * Multi-account manager.
 *
 * Accounts are defined in accounts.txt (one per line):
 *   A1
 *   A2
 *   A3
 *
 * Each account gets:
 *   - sessions/A1.json, sessions/A2.json, etc.
 *   - Auto-created on first run
 *   - Enable/disable via accounts.json (auto-managed)
 */
import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';

const ROOT = config.rootDir;
const ACCOUNTS_TXT = path.join(ROOT, 'accounts.txt');
const ACCOUNTS_JSON = path.join(ROOT, 'accounts.json');

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Read account IDs from accounts.txt
 * Returns array of strings like ['A1', 'A2', 'A3']
 */
function readAccountsTxt() {
  if (!fs.existsSync(ACCOUNTS_TXT)) return [];
  const raw = fs.readFileSync(ACCOUNTS_TXT, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Load accounts.json (runtime state: enabled, lastVote, etc.)
 */
function loadState() {
  if (!fs.existsSync(ACCOUNTS_JSON)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_JSON, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(ACCOUNTS_JSON, JSON.stringify(state, null, 2), 'utf-8');
}

function resolveSessionFile(id) {
  return path.join(ROOT, 'sessions', `${id}.json`);
}

/**
 * Build full account objects by merging accounts.txt with accounts.json state.
 */
function buildAccounts() {
  const ids = readAccountsTxt();
  const state = loadState();

  return ids.map((id) => {
    const accState = state[id] || {};
    return {
      id,
      sessionFile: resolveSessionFile(id),
      enabled: accState.enabled !== false, // default true
      lastVote: accState.lastVote || null,
      lastVoteStatus: accState.lastVoteStatus || null,
    };
  });
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Return every account defined in accounts.txt.
 */
export function getAccounts() {
  return buildAccounts();
}

/**
 * Return only enabled accounts.
 */
export function getEnabledAccounts() {
  return buildAccounts().filter((a) => a.enabled);
}

/**
 * Get a single account by id.
 */
export function getAccount(id) {
  return buildAccounts().find((a) => a.id === id);
}

/**
 * Total number of accounts in accounts.txt.
 */
export function getAccountCount() {
  return readAccountsTxt().length;
}

/**
 * Enable an account.
 */
export function enableAccount(id) {
  const state = loadState();
  if (!state[id]) state[id] = {};
  state[id].enabled = true;
  saveState(state);
}

/**
 * Disable an account.
 */
export function disableAccount(id) {
  const state = loadState();
  if (!state[id]) state[id] = {};
  state[id].enabled = false;
  saveState(state);
}

/**
 * Update vote status for an account.
 */
export function updateAccountStatus(id, { lastVote, lastVoteStatus } = {}) {
  const state = loadState();
  if (!state[id]) state[id] = {};
  if (lastVote !== undefined) state[id].lastVote = lastVote;
  if (lastVoteStatus !== undefined) state[id].lastVoteStatus = lastVoteStatus;
  saveState(state);
}

/**
 * Save cookies to an account's session file.
 */
export function saveAccountSession(id, cookies) {
  const sessionFile = resolveSessionFile(id);
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const state = {
    cookies,
    origins: [{ origin: 'https://runway.edel.finance', localStorage: [] }],
  };
  fs.writeFileSync(sessionFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Check if an account's session file exists.
 */
export function hasAccountSession(id) {
  return fs.existsSync(resolveSessionFile(id));
}

/**
 * Migrate legacy single-account (sessions/state.json) to A1.
 * Only runs if accounts.txt doesn't exist yet.
 */
export function initDefaultAccount() {
  if (fs.existsSync(ACCOUNTS_TXT)) return; // already set up

  const legacySession = path.join(ROOT, 'sessions', 'state.json');
  if (!fs.existsSync(legacySession)) return;

  // Create accounts.txt with A1
  fs.writeFileSync(ACCOUNTS_TXT, 'A1\n', 'utf-8');

  // Copy legacy session → A1
  const target = resolveSessionFile('A1');
  fs.copyFileSync(legacySession, target);

  console.log('✅ Migrated legacy session to A1');
}
