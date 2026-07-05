/**
 * HTTP API client for Edel Runway Desk.
 *
 * All endpoints are relative to https://runway.edel.finance
 * Auth is handled via the `edel_session` cookie (credentials: include).
 *
 * Updated for Preview Listing Round API (June 2026):
 *   GET  /listing/status          → listing system status
 *   GET  /listing-round           → current round + preview data
 *   POST /listing-round           → prepare/start a new round
 *   POST /listing-round/submit    → submit selections
 *   GET  /assets                  → all assets
 *   GET  /demand-index            → demand index rankings
 *   GET  /balances                → user balances
 *
 * Multi-account: all functions accept optional `sessionFile` param.
 */
import fs from 'fs';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { loadSession } from '../auth/session.js';

const BASE_URL = config.baseUrl; // https://runway.edel.finance

// Proxy support — set PROXY_URL in .env
// Supports: socks5://host:port, http://host:port, https://host:port
let fetchWithProxy = globalThis.fetch; // default: no proxy
let proxyInfo = 'none';

if (config.proxyUrl) {
  try {
    const undici = await import('undici');
    const dispatcher = new undici.ProxyAgent(config.proxyUrl);
    fetchWithProxy = (url, opts = {}) => undici.fetch(url, { ...opts, dispatcher });
    proxyInfo = config.proxyUrl;
    logger.info(`🔒 Proxy: ${config.proxyUrl}`);
  } catch (e) {
    logger.warn(`⚠️ Proxy setup failed: ${e.message}. Using direct connection.`);
  }
}

/**
 * Build Cookie header string from saved session cookies.
 * @param {string|null} sessionFile - Path to session JSON (null = default)
 */
function buildCookieHeader(sessionFile = null) {
  let session;
  if (sessionFile) {
    // Load from specific account session file
    if (!fs.existsSync(sessionFile)) {
      return null;
    }
    try {
      session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    } catch {
      return null;
    }
  } else {
    session = loadSession();
  }

  if (!session || !session.cookies || session.cookies.length === 0) {
    return null;
  }

  return session.cookies
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Make an authenticated API request
 */
async function apiFetch(path, options = {}, sessionFile = null) {
  const cookie = buildCookieHeader(sessionFile);
  if (!cookie) {
    throw new Error('No session cookies found. Run: npm run import');
  }

  const url = `${BASE_URL}${path}`;
  const method = options.method || 'GET';

  const headers = {
    accept: 'application/json',
    cookie,
    ...options.headers,
  };

  // Add content-type for POST/PUT/PATCH
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  logger.debug(`📡 ${method} ${path}`);

  const res = await fetchWithProxy(url, {
    method,
    headers,
    body: options.body,
  });

  // Check for auth redirect (session expired)
  if (res.status === 401 || res.status === 403) {
    throw new Error('SESSION_EXPIRED: Cookie is no longer valid. Run: npm run import');
  }

  // Check for redirects to login
  if (res.redirected && (res.url.includes('/login') || res.url.includes('/register'))) {
    throw new Error('SESSION_EXPIRED: Redirected to login. Run: npm run import');
  }

  return res;
}

/**
 * GET request with JSON response
 */
async function apiGet(path, sessionFile = null) {
  const res = await apiFetch(path, {}, sessionFile);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API Error ${res.status} GET ${path}: ${body.substring(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * POST request with JSON body and response
 */
async function apiPost(path, body = {}, sessionFile = null) {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }, sessionFile);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API Error ${res.status} POST ${path}: ${text.substring(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ═══════════════════════════════════════════
//  PUBLIC API FUNCTIONS
// ═══════════════════════════════════════════

/**
 * Get all available assets/teams
 */
export async function getAssets(sessionFile = null) {
  const data = await apiGet('/assets', sessionFile);
  return data.assets || [];
}

/**
 * Get listing system status
 */
export async function getListingStatus(sessionFile = null) {
  return apiGet('/listing/status', sessionFile);
}

/**
 * Get current listing round (Preview API)
 */
export async function getCurrentRound(sessionFile = null) {
  try {
    const data = await apiGet('/listing-round', sessionFile);
    return data;
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('ROUTE_NOT_FOUND')) {
      logger.debug('Preview API failed, trying legacy /listing-rounds/current...');
      return apiGet('/listing-rounds/current', sessionFile);
    }
    throw err;
  }
}

/**
 * Start/prepare a new listing round (Preview API)
 */
export async function startRound(sessionFile = null) {
  try {
    return await apiPost('/listing-round', {}, sessionFile);
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('ROUTE_NOT_FOUND')) {
      logger.debug('Preview start failed, trying legacy /listing-rounds/start...');
      return apiPost('/listing-rounds/start', {}, sessionFile);
    }
    throw err;
  }
}

/**
 * Submit picks/selections (Preview API)
 */
export async function submitPicks(roundId, picks, { isPreview = false, sessionFile = null } = {}) {
  if (isPreview) {
    return apiPost('/listing-round/submit', {
      previewId: roundId,
      picks: picks.map((p) => ({
        listingDecisionId: p.roundDecisionId || p.listingDecisionId,
        assetId: p.assetId,
      })),
    }, sessionFile);
  }

  return apiPost(`/listing-rounds/${roundId}/picks`, { picks }, sessionFile);
}

/**
 * Get demand index / league table
 */
export async function getDemandIndex(sessionFile = null) {
  return apiGet('/demand-index', sessionFile);
}

/**
 * Get balance for an instrument
 */
export async function getBalance(instrumentId, sessionFile = null) {
  const params = instrumentId ? `?instrumentId=${instrumentId}` : '';
  return apiGet(`/balances${params}`, sessionFile);
}

/**
 * Check if the session is valid by calling the API
 */
export async function checkSession(sessionFile = null) {
  try {
    await apiGet('/listing/status', sessionFile);
    return true;
  } catch (err) {
    if (err.message.includes('SESSION_EXPIRED')) return false;
    try {
      await apiGet('/profile', sessionFile);
      return true;
    } catch {
      return false;
    }
  }
}
