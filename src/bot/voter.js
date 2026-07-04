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
import { pickAsset, STRATEGIES } from './strategies.js';

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

  // ── Verbose structure logging ──────────────────
  const keys = Object.keys(data);
  logger.info(`📦 API response keys: [${keys.join(', ')}]`);
  if (data.round) {
    const rKeys = Object.keys(data.round);
    logger.info(`   ↳ round keys: [${rKeys.join(', ')}]`);
    // Check for arrays inside round
    for (const k of rKeys) {
      if (Array.isArray(data.round[k])) {
        logger.info(`   ↳ round.${k} = Array(${data.round[k].length})`);
      }
    }
  }
  if (data.preview) {
    const pKeys = Object.keys(data.preview);
    logger.info(`   ↳ preview keys: [${pKeys.join(', ')}]`);
    for (const k of pKeys) {
      if (Array.isArray(data.preview[k])) {
        logger.info(`   ↳ preview.${k} = Array(${data.preview[k].length})`);
      }
    }
  }
  // Log top-level arrays
  for (const k of keys) {
    if (Array.isArray(data[k])) {
      logger.info(`   ↳ ${k} = Array(${data[k].length})`);
    }
  }

  let status = null;
  let roundId = null;
  let fixtures = null;
  let actions = null;
  let stakeAmount = null;
  let isPreview = false;

  // ── Detect status from round object ──────────
  if (data.round) {
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

  // ── Detect preview ──────────────────────────
  if (data.preview) {
    isPreview = true;
    // For preview submit, we MUST use preview.id as the previewId
    roundId = data.preview.id;
    if (!status) status = 'LOCKED'; // preview = selections open
    if (!stakeAmount) stakeAmount = data.preview.stakeAmount;
  }

  // ── Status from top-level ──────────────────
  if (!status && data.status && typeof data.status === 'string') {
    status = data.status;
  }
  if (!roundId) {
    roundId = data.roundId || data.id || findKey(data, 'roundId');
  }

  // ── Find fixtures/decisions from ALL possible locations ──
  const candidateArrays = [
    // Preview API uses "options" for the head-to-head calls
    data.preview?.options,
    data.options,
    // Top-level
    data.decisions,
    data.fixtures,
    data.listingDecisions,
    data.roundDecisions,
    data.calls,
    // Inside round
    data.round?.decisions,
    data.round?.fixtures,
    data.round?.listingDecisions,
    data.round?.roundDecisions,
    data.round?.options,
    data.round?.calls,
    data.round?.round?.decisions,
    data.round?.round?.fixtures,
    // Inside preview (other field names)
    data.preview?.decisions,
    data.preview?.fixtures,
    data.preview?.listingDecisions,
    data.preview?.calls,
    // Inside currentWindow
    data.currentWindow?.decisions,
    data.currentWindow?.fixtures,
  ];

  for (const arr of candidateArrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      fixtures = arr;
      logger.info(`   ✅ Found ${arr.length} fixtures/decisions`);
      // Log first item structure for debugging
      const firstItem = arr[0];
      logger.info(`   ↳ First item keys: [${Object.keys(firstItem).join(', ')}]`);
      break;
    }
  }

  // Last resort: deep search
  if (!fixtures || fixtures.length === 0) {
    const deepDecisions = findKey(data, 'decisions', 4);
    const deepFixtures = findKey(data, 'fixtures', 4);
    const deepCalls = findKey(data, 'calls', 4);
    fixtures = (Array.isArray(deepDecisions) && deepDecisions.length > 0) ? deepDecisions
      : (Array.isArray(deepFixtures) && deepFixtures.length > 0) ? deepFixtures
      : (Array.isArray(deepCalls) && deepCalls.length > 0) ? deepCalls
      : [];
    if (fixtures.length > 0) {
      logger.info(`   ✅ Found ${fixtures.length} via deep search`);
      logger.info(`   ↳ First item keys: [${Object.keys(fixtures[0]).join(', ')}]`);
    } else {
      // No fixtures — likely settlement pending or between rounds
      logger.info('   ⏳ No fixtures available yet (settlement pending or between rounds)');
    }
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

  const selectedId = pickAsset(teamAId, teamBId, assetMap, strategy);
  const picked = assetMap.get(selectedId);
  const other = selectedId === teamAId ? b : a;
  const strategyLabel = strategy.startsWith('pick-') ? strategy : strategy;
  logger.info(`   🎯 ${a?.ticker || 'A'} vs ${b?.ticker || 'B'} → ${picked?.ticker || selectedId} [${strategyLabel}]`);

  return selectedId;
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
 * @param {object} [account] - { id, sessionFile } for multi-account mode
 */
export async function performVote(account = null) {
  const strategy = config.voteStrategy;
  const tag = account ? `[${account.id}] ` : '';
  const sessionFile = account?.sessionFile || null;
  logSeparator();
  logger.info(`${tag}🗳️  Starting vote | Strategy: ${strategy}`);

  try {
    // Step 1: Get current round
    logger.info(`${tag}📡 Fetching current round...`);
    const rawData = await getCurrentRound(sessionFile);

    // Debug: log raw response structure
    logger.debug(`🔍 Raw response: ${JSON.stringify(rawData).substring(0, 500)}`);

    const parsed = parseRoundData(rawData);
    if (!parsed) {
      return { success: false, details: { error: 'Empty API response', strategy } };
    }

    // Extract round timing for smart scheduling — check ALL possible locations
    const roundTiming = parsed.currentWindow?.timing
      || rawData?.currentWindow?.timing
      || rawData?.timing
      || parsed.raw?.currentWindow?.timing
      || rawData?.round?.timing
      || parsed.raw?.round?.timing
      || null;

    // Debug round timing
    if (roundTiming) {
      logger.info(`📅 Round timing: nextRoundStartsAt=${roundTiming.nextRoundStartsAt}, selectionClosesAt=${roundTiming.selectionClosesAt}`);
    } else {
      logger.info('📅 No round timing found in API response');
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
        roundTiming,
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
        roundTiming,
        details: {
          asset: 'N/A', strategy, round: parsed.roundId,
          note: `Waiting (${formatStatus(parsed.status)})`,
        },
      };
    }

    // Step 4: Window closed / failed?
    if (['EXPIRED', 'FAILED'].includes(parsed.status)) {
      // Try to prepare round (needed to open listing calls)
      const startAction = parsed.actions?.startRound || parsed.actions?.prepareRound;
      if (startAction?.enabled !== false) {
        logger.info(`${tag}🚀 Opening listing calls...`);
        const startResult = await startRound(sessionFile);
        const startParsed = parseRoundData(startResult);
        logger.info(`${tag}✅ New round: ${formatStatus(startParsed?.status)}`);

        if (startParsed?.status === 'LOCKED' && startParsed.fixtures.length > 0) {
          // Wait for stake lock to complete before submitting
          logger.info(`${tag}⏳ Waiting 30s for stake lock...`);
          await new Promise((resolve) => setTimeout(resolve, 30000));

          // Re-fetch fresh data after the wait
          logger.info(`${tag}📡 Re-fetching fresh round data...`);
          const freshData = await getCurrentRound(sessionFile);
          const freshParsed = parseRoundData(freshData);

          if (freshParsed?.status === 'LOCKED' && freshParsed.fixtures.length > 0) {
            const voteResult = await doVoting(freshParsed, strategy, sessionFile, tag);
            voteResult.roundTiming = roundTiming;
            return voteResult;
          }
        }

        // Not ready yet — will retry on next cycle
        return {
          success: true,
          roundTiming,
          details: {
            asset: 'N/A', strategy, round: startParsed?.roundId,
            note: `Round opened (${formatStatus(startParsed?.status)}). Will vote when ready.`,
          },
        };
      }

      const reason = startAction?.reason || 'No start action available';
      logger.info(`${tag}⏳ Cannot prepare: ${reason}`);
      return {
        success: true,
        roundTiming,
        details: { asset: 'N/A', strategy, round: 'N/A', note: `Cannot prepare: ${reason}` },
      };
    }

    // Step 5: No round at all? Try to prepare one.
    if (!parsed.status) {
      const startAction = parsed.actions?.startRound || parsed.actions?.prepareRound;
      if (startAction?.enabled !== false) {
        logger.info(`${tag}🚀 No active round. Opening listing calls...`);
        const startResult = await startRound(sessionFile);
        const startParsed = parseRoundData(startResult);
        logger.info(`${tag}✅ New round: ${formatStatus(startParsed?.status)}`);

        if (startParsed?.status === 'LOCKED' && startParsed.fixtures.length > 0) {
          logger.info(`${tag}⏳ Waiting 30s for stake lock...`);
          await new Promise((resolve) => setTimeout(resolve, 30000));

          logger.info(`${tag}📡 Re-fetching fresh round data...`);
          const freshData = await getCurrentRound(sessionFile);
          const freshParsed = parseRoundData(freshData);

          if (freshParsed?.status === 'LOCKED' && freshParsed.fixtures.length > 0) {
            const voteResult = await doVoting(freshParsed, strategy, sessionFile, tag);
            voteResult.roundTiming = roundTiming;
            return voteResult;
          }
        }

        return {
          success: true,
          roundTiming,
          details: {
            asset: 'N/A', strategy, round: startParsed?.roundId,
            note: `Round opened (${formatStatus(startParsed?.status)}). Will vote when ready.`,
          },
        };
      }

      // prepareRound not enabled — round might already exist (started by another account)
      // Return 'waiting' so bot retries on next cycle instead of giving up
      logger.info(`${tag}⏳ Round already started by another account. Will retry.`);
      return {
        success: true,
        roundTiming,
        details: { asset: 'N/A', strategy, round: 'N/A', note: 'Round already started — retrying' },
      };
    }

    // Step 6: LOCKED = selections are open!
    if (parsed.status === 'LOCKED') {
      const voteResult = await doVoting(parsed, strategy, sessionFile, tag);
      voteResult.roundTiming = roundTiming;
      return voteResult;
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
 * Actually perform voting on open fixtures.
 * Includes retry logic for transient submit errors (STAKE_LOCK_FAILED, INVALID_PICK).
 */
async function doVoting(parsed, strategy, sessionFile = null, tag = '') {
  const MAX_SUBMIT_RETRIES = 5;

  // Load assets for display
  let assetMap = new Map();
  try {
    const assets = await getAssets(sessionFile);
    assetMap = new Map(assets.map((a) => [a.id || a.assetId, a]));
  } catch (err) {
    logger.debug(`Could not load assets: ${err.message}`);
  }

  /**
   * Build picks from parsed round data
   */
  function buildPicks(roundParsed) {
    const { fixtures } = roundParsed;
    const newPicks = [];
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i];
      const { id, teamAId, teamBId, selectedTeamId } = getFixtureTeams(fixture);

      if (!teamAId || !teamBId) {
        logger.debug(`   ${i + 1}. Skipping (missing teams): ${JSON.stringify(fixture).substring(0, 150)}`);
        continue;
      }

      if (selectedTeamId) {
        const selected = assetMap.get(selectedTeamId);
        logger.info(`   ${i + 1}. Already picked: ${selected?.ticker || selectedTeamId}`);
        newPicks.push({ roundDecisionId: id, assetId: selectedTeamId });
        continue;
      }

      const selectedId = selectTeam(teamAId, teamBId, assetMap, strategy);
      newPicks.push({ roundDecisionId: id, assetId: selectedId });
    }
    return newPicks;
  }

  // Build initial picks
  let { roundId, fixtures, isPreview } = parsed;
  logger.info(`${tag}✅ Calls are OPEN! ${fixtures.length} head-to-head fixtures`);
  let picks = buildPicks(parsed);

  if (picks.length === 0) {
    logger.warn(`${tag}⚠️  No picks to submit.`);
    return { success: false, details: { error: 'No valid fixtures to pick', strategy } };
  }

  // Submit picks — retry with SAME payload on STAKE_LOCK_FAILED
  // On INVALID_PICK: start fresh round → rebuild picks → retry
  for (let submitAttempt = 1; submitAttempt <= MAX_SUBMIT_RETRIES; submitAttempt++) {
    logger.info(`${tag}📤 Submitting ${picks.length} picks (attempt ${submitAttempt}/${MAX_SUBMIT_RETRIES})...`);

    try {
      const result = await submitPicks(roundId, picks, { isPreview, sessionFile });
      const newParsed = parseRoundData(result);
      logger.info(`${tag}✅ Picks submitted! Status: ${formatStatus(newParsed?.status)}`);

      // Extract timing from submit response
      const submitTiming = newParsed?.currentWindow?.timing
        || result?.currentWindow?.timing
        || result?.round?.timing
        || newParsed?.raw?.round?.timing
        || null;

      const pickedAssets = picks.map((p) => assetMap.get(p.assetId)?.ticker || 'unknown').join(', ');
      const details = { asset: pickedAssets, strategy, round: roundId, fixtureCount: fixtures.length };
      logVote(true, details);
      return { success: true, details, roundTiming: submitTiming };

    } catch (submitErr) {
      const errMsg = submitErr.message;
      logger.warn(`${tag}⚠️  Submit attempt ${submitAttempt} failed: ${errMsg.substring(0, 200)}`);

      const isStakeLock = errMsg.includes('STAKE_LOCK_FAILED');
      const isInvalidPick = errMsg.includes('INVALID_PICK');
      const isRateLimit = errMsg.includes('429') || errMsg.includes('Too Many Requests');

      // Rate limit → longer backoff
      if (isRateLimit && submitAttempt < MAX_SUBMIT_RETRIES) {
        const backoff = 30000 * submitAttempt; // 30s, 60s, 90s
        logger.info(`${tag}⏳ Rate limited (429). Waiting ${backoff/1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      // INVALID_PICK = stale preview data → start fresh round to get new preview
      if (isInvalidPick && submitAttempt < MAX_SUBMIT_RETRIES) {
        logger.info(`${tag}🔄 INVALID_PICK: refreshing calls (starting new round)...`);
        try {
          const freshStart = await startRound(sessionFile);
          const freshParsed = parseRoundData(freshStart);

          if (freshParsed?.status === 'LOCKED' && freshParsed.fixtures.length > 0) {
            logger.info(`${tag}⏳ Waiting 8s for stake lock...`);
            await new Promise((resolve) => setTimeout(resolve, 8000));

            // Re-fetch after wait
            const freshData = await getCurrentRound(sessionFile);
            const reParsed = parseRoundData(freshData);

            if (reParsed?.status === 'LOCKED' && reParsed.fixtures.length > 0) {
              // Rebuild picks with FRESH data
              roundId = reParsed.roundId;
              fixtures = reParsed.fixtures;
              isPreview = reParsed.isPreview;
              picks = buildPicks(reParsed);
              logger.info(`${tag}🔄 Got fresh preview: ${roundId?.substring(0, 50)}..., ${fixtures.length} fixtures`);
              continue; // retry submit with new data
            }
          }
        } catch (refreshErr) {
          logger.warn(`${tag}⚠️  Refresh failed: ${refreshErr.message.substring(0, 100)}`);
        }
      }

      // STAKE_LOCK_FAILED → retry with same payload after short delay
      if (isStakeLock && submitAttempt < MAX_SUBMIT_RETRIES) {
        logger.info(`${tag}⏳ STAKE_LOCK_FAILED: waiting 5s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      // Other errors or last attempt
      if (submitAttempt >= MAX_SUBMIT_RETRIES) {
        logger.error(`${tag}❌ All ${MAX_SUBMIT_RETRIES} submit attempts failed.`);
        return { success: false, details: { error: errMsg.substring(0, 200), strategy } };
      }

      // Generic retry delay
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  return { success: false, details: { error: 'Max submit retries exceeded', strategy } };
}
