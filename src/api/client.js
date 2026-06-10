/**
 * HTTP API client for Edel Runway Desk.
 *
 * All endpoints are relative to https://runway.edel.finance
 * Auth is handled via the `edel_session` cookie (credentials: include).
 */
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { loadSession } from '../auth/session.js';

const BASE_URL = config.baseUrl; // https://runway.edel.finance

/**
 * Build Cookie header string from saved session cookies
 */
function buildCookieHeader() {
  const session = loadSession();
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
async function apiFetch(path, options = {}) {
  const cookie = buildCookieHeader();
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

  const res = await fetch(url, {
    method,
    headers,
    body: options.body,
  });

  // Check for auth redirect (session expired)
  if (res.status === 401 || res.status === 403) {
    throw new Error('SESSION_EXPIRED: Cookie tidak valid lagi. Run: npm run import');
  }

  // Check for redirects to login
  if (res.redirected && (res.url.includes('/login') || res.url.includes('/register'))) {
    throw new Error('SESSION_EXPIRED: Redirected ke login. Run: npm run import');
  }

  return res;
}

/**
 * GET request with JSON response
 */
async function apiGet(path) {
  const res = await apiFetch(path);
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
async function apiPost(path, body = {}) {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
 * GET /assets
 */
export async function getAssets() {
  const data = await apiGet('/assets');
  return data.assets || [];
}

/**
 * Get current listing round + fixtures + actions
 * GET /listing-rounds/current
 */
export async function getCurrentRound() {
  return apiGet('/listing-rounds/current');
}

/**
 * Start a new listing round (opens call window)
 * POST /listing-rounds/start
 */
export async function startRound() {
  return apiPost('/listing-rounds/start', {});
}

/**
 * Submit picks (votes) for a round
 * POST /listing-rounds/{roundId}/picks
 *
 * @param {string} roundId
 * @param {Array<{roundDecisionId: string, assetId: string}>} picks
 */
export async function submitPicks(roundId, picks) {
  return apiPost(`/listing-rounds/${roundId}/picks`, { picks });
}

/**
 * Get demand index / league table
 * GET /demand-index
 */
export async function getDemandIndex() {
  return apiGet('/demand-index');
}

/**
 * Get balance for an instrument
 * GET /balances?instrumentId=xxx
 */
export async function getBalance(instrumentId) {
  const params = instrumentId ? `?instrumentId=${instrumentId}` : '';
  return apiGet(`/balances${params}`);
}

/**
 * Check if the session is valid by calling the API
 * Returns true if authenticated, false if expired
 */
export async function checkSession() {
  try {
    await getCurrentRound();
    return true;
  } catch (err) {
    if (err.message.includes('SESSION_EXPIRED')) return false;
    // Other errors (network, etc.) - still might be valid
    logger.debug(`Session check error: ${err.message}`);
    return false;
  }
}
