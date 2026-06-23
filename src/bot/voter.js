/**
 * Core voting engine — pure HTTP, no browser needed.
 *
 * Updated for Preview Listing Round API (June 2026).
 *
 * Flow:
 *   1. GET /listing-round → check round/preview status & fixtures
 *   2. If status is LOCKED or preview has decisions → pick assets
 *   3. POST /listing-round/submit → submit all selections
 *
 * Handles both Preview API (new) and Legacy API (old) response formats.
 */
import config from '../utils/config.js';
import logger, { logVote, logSeparator } from '../utils/logger.js';
import { getCurrentRound, startRound, submitPicks, getAssets } from '../api/client.js';

/**
 * Deep-search for a key in a nested object.
 * Returns the first value found matching the key name.
 */
function findKey(obj, key, maxDepth = 5) {
  if (!obj || typeof obj !== 'object' || maxDepth <= 0) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key, maxDepth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Extract round info from the API response, regardless of nesting.
 *
 * Supports both:
 *   - Preview API: { preview: {...}, actions: {prepareRound, submitPreview}, currentWindow }
 *   - Legacy API:  { round: {...}, fixtures: [...], actions: {startRound} }
 */
function parseRoundData(data) {
  if (!data) return null;

  // Log raw structure for debugging
  const keys = Object.keys(data);
  logger.debug(`📦 API response keys: ${keys.join(', ')}`);

  let status = null;
  let roundId = null;
  let fixtures = null;
  let actions = null;
  let stakeAmount = null;
  let isPreview = false;

  // ── Preview API format ──────────────────────
  // { preview: { id, roundWindowId, decisions: [...], ... }, actions: {...}, currentWindow: {...} }
  if (data.preview) {
    isPreview = true;
    const preview = data.preview;
    roundId = preview.id;
    status = 'LOCKED'; // If preview exists, selections are open
    stakeAmount = preview.stakeAmount;

    // Decisions in preview format
    fixtures = preview.decisions || preview.fixtures || [];

    // Map preview decisions to our standard fixture format
    if (fixtures.length > 0 && fixtures[0].listingDecisionId) {
      fixtures = fixtures.map((d) => ({
        id: d.listingDecisionId || d.id,
        roundDecisionId: d.listingDecisionId || d.id,
        teamAId: d.optionA?.assetId || d.assetAId || d.teamAId,
        teamBId: d.optionB?.assetId || d.assetBId || d.teamBId,
        selectedTeamId: d.selectedAssetId || d.selectedTeamId || null,
        optionA: d.optionA,
        optionB: d.optionB,
        _raw: d,
      }));
    }

    actions = data.actions || {};
    logger.debug(`📊 Preview format: id=${roundId}, decisions=${fixtures.length}`);
  }

  // ── Legacy API format ──────────────────────
  // { round: { status, id, fixtures/decisions }, actions: {startRound} }
  if (!isPreview && data.round) {
    if (data.round.status && typeof data.round.status === 'string') {
      status = data.round.status;
      roundId = data.round.id || data.round.roundId;
      stakeAmount = data.round.stakeAmount;
    } else if (data.round.round && typeof data.round.round === 'object') {
      status = data.round.round.status;
      roundId = data.round.round.id || data.round.round.roundId;
      stakeAmount = data.round.round.stakeAmount;
    }
  }

  // ── Status from top-level (some responses) ──
  if (!status && data.status && typeof data.status === 'string') {
    status = data.status;
  }
  if (!roundId) {
    roundId = data.roundId || data.id || findKey(data, 'roundId') || findKey(data, 'id');
  }

  // ── Fixtures (if not already set from preview) ──
  if (!fixtures || fixtures.length === 0) {
    fixtures = data.fixtures || data.decisions ||
      data.round?.fixtures || data.round?.decisions ||
      findKey(data, 'fixtures') || findKey(data, 'decisions') || [];
  }

  if (!Array.isArray(fixtures)) fixtures = [];

  // ── Actions ──
  if (!actions) {
    actions = data.actions || data.round?.actions || {};
  }

  // ── Normalize action names (preview uses prepareRound, legacy uses startRound) ──
  if (actions.prepareRound && !actions.startRound) {
    actions.startRound = actions.prepareRound;
  }

  const currentWindow = data.currentWindow || data.round?.currentWindow || null;

  logger.debug(`📊 Parsed: status=${status}, roundId=${roundId}, fixtures=${fixtures.length}, isPreview=${isPreview}, actions=${JSON.stringify(Object.keys(actions))}`);

  return { status, roundId, fixtures, actions, stakeAmount, currentWindow, isPreview, raw: data };
}

/**
 * Extract fixture team IDs - handles different field names
 */
function getFixtureTeams(fixture) {
  return {
    id: fixture.id || fixture.roundDecisionId || fixture.listingDecisionId,
    teamAId: fixture.teamAId || fixture.assetAId || fixture.optionA?.assetId || fixture.optionA?.id,
    teamBId: fixture.teamBId || fixture.assetBId || fixture.optionB?.assetId || fixture.optionB?.id,
    selectedTeamId: fixture.selectedTeamId || fixture.selectedAssetId || null,
  };
}

/**
 * Select which team to pick for a fixture based on strategy
 */
function selectTeam(teamAId, teamBId, assetMap, strategy) {
  const a = assetMap.get(teamAId);
  const b = assetMap.get(teamBId);

  switch (strategy) {
    case 'first':
      return teamAId;
    case 'second':
      return teamBId;
    case 'smart':
    case 'random':
    default: {
      const pick = Math.random() < 0.5 ? teamAId : teamBId;
      const picked = assetMap.get(pick);
      logger.info(`   🎯 ${a?.ticker || 'A'} vs ${b?.ticker || 'B'} → ${picked?.ticker || pick}`);
      return pick;
    }
  }
}

/**
 * Format listing call status for display
 */
function formatStatus(status) {
  const map = {
    CREATED: 'Created',
    LOCK_PENDING: 'Allocation Pending',
    LOCKED: 'Calls Open ✅',
    SUBMITTED: 'Selections Submitted',
    SETTLEMENT_PENDING: 'Demand Index Pending',
    SETTLED: 'Demand Index Final',
    EXPIRED: 'Window Closed',
    FAILED: 'Review Required',
  };
  return map[status] || status || 'unknown';
}

/**
 * Main voting function — pure HTTP, no browser
 */
export async function performVote() {
  const strategy = config.voteStrategy;
  logSeparator();
  logger.info(`🗳️  Starting vote | Strategy: ${strategy}`);

  try {
    // Step 1: Get current round
    logger.info('📡 Fetching current round...');
    const rawData = await getCurrentRound();

    // Debug: log raw response structure
    logger.debug(`🔍 Raw response: ${JSON.stringify(rawData).substring(0, 500)}`);

    const parsed = parseRoundData(rawData);
    if (!parsed) {
      return { success: false, details: { error: 'Empty API response', strategy } };
    }

    logger.info(`📊 Round status: ${formatStatus(parsed.status)}`);
    logger.info(`📋 Fixtures: ${parsed.fixtures.length}`);
    if (parsed.isPreview) {
      logger.info(`🆕 Using Preview API`);
    }

    // Step 2: Already submitted?
    if (['SUBMITTED', 'SETTLEMENT_PENDING', 'SETTLED'].includes(parsed.status)) {
      logger.info('ℹ️  Already submitted for this round.');
      return {
        success: true,
        details: {
          asset: 'N/A', strategy, round: parsed.roundId,
          note: `Already submitted (${formatStatus(parsed.status)})`,
        },
      };
    }

    // Step 3: Calls not open yet?
    if (['CREATED', 'LOCK_PENDING'].includes(parsed.status)) {
      logger.info('⏳ Allocation pending. Calls not open yet.');
      return {
        success: true,
        details: {
          asset: 'N/A', strategy, round: parsed.roundId,
          note: `Waiting (${formatStatus(parsed.status)})`,
        },
      };
    }

    // Step 4: Window closed / failed?
    if (['EXPIRED', 'FAILED'].includes(parsed.status)) {
      // Try to start a new round
      const startAction = parsed.actions?.startRound || parsed.actions?.prepareRound;
      if (startAction?.enabled !== false) {
        logger.info('🚀 Starting new listing round...');
        const startResult = await startRound();
        logger.debug(`🔍 Start result: ${JSON.stringify(startResult).substring(0, 500)}`);
        const newParsed = parseRoundData(startResult);
        logger.info(`✅ New round: ${formatStatus(newParsed?.status)}`);

        // If the new round is LOCKED, continue to vote below
        if (newParsed?.status === 'LOCKED') {
          return doVoting(newParsed, strategy);
        }

        return {
          success: true,
          details: {
            asset: 'N/A', strategy, round: newParsed?.roundId,
            note: `Round started, status: ${formatStatus(newParsed?.status)}. Will vote when calls open.`,
          },
        };
      }

      const reason = startAction?.reason || 'No start action available';
      logger.info(`⏳ Cannot start: ${reason}`);
      return {
        success: true,
        details: { asset: 'N/A', strategy, round: 'N/A', note: `Window closed: ${reason}` },
      };
    }

    // Step 5: No round at all? Try to start one.
    if (!parsed.status) {
      const startAction = parsed.actions?.startRound || parsed.actions?.prepareRound;
      if (startAction?.enabled !== false) {
        logger.info('🚀 No active round. Starting new one...');
        const startResult = await startRound();
        logger.debug(`🔍 Start result: ${JSON.stringify(startResult).substring(0, 500)}`);
        const newParsed = parseRoundData(startResult);
        logger.info(`✅ New round: ${formatStatus(newParsed?.status)}`);

        if (newParsed?.status === 'LOCKED') {
          return doVoting(newParsed, strategy);
        }

        return {
          success: true,
          details: {
            asset: 'N/A', strategy, round: newParsed?.roundId,
            note: `Round started (${formatStatus(newParsed?.status)}). Will vote when calls open.`,
          },
        };
      }

      logger.info('⏳ No round and cannot start one.');
      return {
        success: true,
        details: { asset: 'N/A', strategy, round: 'N/A', note: 'No active round available' },
      };
    }

    // Step 6: LOCKED = selections are open!
    if (parsed.status === 'LOCKED') {
      return doVoting(parsed, strategy);
    }

    // Unknown status
    logger.warn(`⚠️  Unknown status: ${parsed.status}`);
    return { success: false, details: { error: `Unknown status: ${parsed.status}`, strategy } };

  } catch (err) {
    const isSessionError = err.message.includes('SESSION_EXPIRED');
    logger.error(`${isSessionError ? '🔑' : '❌'} Vote failed: ${err.message}`);
    const details = { error: err.message, strategy, sessionExpired: isSessionError };
    logVote(false, details);
    return { success: false, details };
  }
}

/**
 * Actually perform voting on open fixtures
 */
async function doVoting(parsed, strategy) {
  const { roundId, fixtures, isPreview } = parsed;
  logger.info(`✅ Calls are OPEN! ${fixtures.length} head-to-head fixtures`);

  // Load assets for display
  let assetMap = new Map();
  try {
    const assets = await getAssets();
    assetMap = new Map(assets.map((a) => [a.id || a.assetId, a]));
    logger.debug(`📦 Loaded ${assetMap.size} assets`);
  } catch (err) {
    logger.debug(`Could not load assets: ${err.message}`);
  }

  // Make selections for each fixture
  const picks = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const { id, teamAId, teamBId, selectedTeamId } = getFixtureTeams(fixture);

    if (!teamAId || !teamBId) {
      logger.debug(`   ${i + 1}. Skipping fixture (missing teams): ${JSON.stringify(fixture).substring(0, 200)}`);
      continue;
    }

    // If already selected, keep it
    if (selectedTeamId) {
      const selected = assetMap.get(selectedTeamId);
      logger.info(`   ${i + 1}. Already picked: ${selected?.ticker || selectedTeamId}`);
      picks.push({ roundDecisionId: id, assetId: selectedTeamId });
      continue;
    }

    // Make a new selection
    const selectedId = selectTeam(teamAId, teamBId, assetMap, strategy);
    picks.push({ roundDecisionId: id, assetId: selectedId });
  }

  if (picks.length === 0) {
    logger.warn('⚠️  No picks to submit.');
    return { success: false, details: { error: 'No valid fixtures to pick', strategy } };
  }

  // Submit all picks
  logger.info(`📤 Submitting ${picks.length} picks for round ${roundId}...`);
  const result = await submitPicks(roundId, picks, { isPreview });

  const newParsed = parseRoundData(result);
  logger.info(`✅ Picks submitted! Status: ${formatStatus(newParsed?.status)}`);

  const pickedAssets = picks
    .map((p) => assetMap.get(p.assetId)?.ticker || 'unknown')
    .join(', ');

  const details = {
    asset: pickedAssets,
    strategy,
    round: roundId,
    fixtureCount: fixtures.length,
  };

  logVote(true, details);
  return { success: true, details };
}
