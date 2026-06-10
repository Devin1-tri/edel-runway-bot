import fs from 'fs';
import path from 'path';
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
 * @returns {number|null} Age in hours or null if no session
 */
export function getSessionAge() {
  if (!fs.existsSync(config.sessionFile)) return null;
  const stats = fs.statSync(config.sessionFile);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs / (1000 * 60 * 60);
}

/**
 * Check if session might be expired (older than 24 hours)
 * Note: Actual validity depends on server-side token expiry
 */
export function isSessionLikelyExpired() {
  const age = getSessionAge();
  if (age === null) return true;
  // Privy sessions typically last several days, but we warn after 48h
  return age > 48;
}
