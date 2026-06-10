/**
 * Core voting engine — pure HTTP, no browser needed.
 *
 * Flow:
 *   1. GET /listing-rounds/current → check round status & fixtures
 *   2. If status is LOCKED → selections are open → pick assets
 *   3. POST /listing-rounds/{roundId}/picks → submit all picks
 *   4. If no round → POST /listing-rounds/start → open a new round
 */
import config from '../utils/config.js';
import logger, { logVote, logSeparator } from '../utils/logger.js';
import { getCurrentRound, startRound, submitPicks, getAssets } from '../api/client.js';

/**
 * Smart strategy: pick the asset with more market popularity.
 * If we have demand index data, use that; otherwise random.
 */
function smartSelect(teamA, teamB, assetMap) {
  // Both assets available — compare by any signals we have
  const a = assetMap.get(teamA);
  const b = assetMap.get(teamB);

  if (a && b) {
    // Use asset name/ticker for some heuristic
    // In real usage, this could be enhanced with demand-index data
    logger.info(`🧠 Smart: "${a.name || a.ticker}" vs "${b.name || b.ticker}"`);
  }

  // Default: randomly pick one (50/50) — fair for head-to-head
  const pick = Math.random() < 0.5 ? teamA : teamB;
  const picked = assetMap.get(pick);
  logger.info(`🧠 Smart pick: ${picked?.ticker || pick}`);
  return pick;
}

/**
 * Select which team to pick for a fixture based on strategy
 */
function selectTeam(teamAId, teamBId, assetMap, strategy) {
  switch (strategy) {
    case 'first':
      return teamAId;

    case 'second':
      return teamBId;

    case 'smart':
      return smartSelect(teamAId, teamBId, assetMap);

    case 'random':
    default:
      return Math.random() < 0.5 ? teamAId : teamBId;
  }
}

/**
 * Format listing call status for display
 */
function formatStatus(status) {
  const map = {
    CREATED: 'Created',
    LOCK_PENDING: 'Allocation Pending',
    LOCKED: 'Calls Open',
    SUBMITTED: 'Selections Submitted',
    SETTLEMENT_PENDING: 'Demand Index Pending',
    SETTLED: 'Demand Index Final',
    EXPIRED: 'Window Closed',
    FAILED: 'Review Required',
  };
  return map[status] || status;
}

/**
 * Main voting function — pure HTTP, no browser
 *
 * @returns {{ success: boolean, details: object }}
 */
export async function performVote() {
  const strategy = config.voteStrategy;
  logSeparator();
  logger.info(`🗳️  Starting vote | Strategy: ${strategy}`);

  try {
    // Step 1: Get current round
    logger.info('📡 Fetching current round...');
    let roundData = await getCurrentRound();

    const roundStatus = roundData?.round?.round?.status;
    const actions = roundData?.actions;

    logger.info(`📊 Round status: ${formatStatus(roundStatus) || 'No active round'}`);

    // Step 2: Check if we already submitted
    if (['SUBMITTED', 'SETTLEMENT_PENDING', 'SETTLED'].includes(roundStatus)) {
      logger.info('ℹ️  Already submitted for this round.');
      return {
        success: true,
        details: {
          asset: 'N/A',
          strategy,
          round: roundData.round.round.id,
          note: `Already submitted (status: ${formatStatus(roundStatus)})`,
        },
      };
    }

    // Step 3: If expired/failed or no round, try to start a new one
    if (!roundData?.round || ['EXPIRED', 'FAILED'].includes(roundStatus)) {
      if (actions?.startRound?.enabled) {
        logger.info('🚀 Starting new listing round...');
        roundData = await startRound();
        logger.info(`✅ New round started: ${roundData?.round?.round?.status}`);
      } else {
        const reason = actions?.startRound?.reason || 'Unknown';
        logger.info(`⏳ Cannot start round: ${reason}`);
        return {
          success: true,
          details: {
            asset: 'N/A',
            strategy,
            round: 'N/A',
            note: `No round available: ${reason}`,
          },
        };
      }
    }

    // Step 4: If CREATED or LOCK_PENDING, selections aren't open yet
    if (['CREATED', 'LOCK_PENDING'].includes(roundData?.round?.round?.status)) {
      logger.info('⏳ Round is preparing (allocation pending). Selections not open yet.');
      return {
        success: true,
        details: {
          asset: 'N/A',
          strategy,
          round: roundData.round.round.id,
          note: `Waiting for calls to open (status: ${formatStatus(roundData.round.round.status)})`,
        },
      };
    }

    // Step 5: LOCKED = selections are open!
    if (roundData?.round?.round?.status !== 'LOCKED') {
      logger.warn(`⚠️  Unexpected status: ${roundData?.round?.round?.status}`);
      return {
        success: false,
        details: {
          error: `Unexpected round status: ${roundData?.round?.round?.status}`,
          strategy,
        },
      };
    }

    const round = roundData.round;
    const fixtures = round.fixtures || [];
    const roundId = round.round.id;

    logger.info(`✅ Calls are OPEN! ${fixtures.length} head-to-head fixtures`);

    // Step 6: Load assets for smart selection
    let assetMap = new Map();
    try {
      const assets = await getAssets();
      assetMap = new Map(assets.map((a) => [a.id, a]));
      logger.debug(`📦 Loaded ${assetMap.size} assets`);
    } catch (err) {
      logger.debug(`Could not load assets: ${err.message}`);
    }

    // Step 7: Make selections for each fixture
    const picks = [];
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i];
      const teamAId = fixture.teamAId;
      const teamBId = fixture.teamBId;

      // If already selected, keep it
      if (fixture.selectedTeamId) {
        logger.info(`   ${i + 1}. Already picked: ${assetMap.get(fixture.selectedTeamId)?.ticker || fixture.selectedTeamId}`);
        picks.push({
          roundDecisionId: fixture.id,
          assetId: fixture.selectedTeamId,
        });
        continue;
      }

      // Make a new selection
      const selectedId = selectTeam(teamAId, teamBId, assetMap, strategy);
      const teamA = assetMap.get(teamAId);
      const teamB = assetMap.get(teamBId);
      const selected = assetMap.get(selectedId);

      logger.info(
        `   ${i + 1}. ${teamA?.ticker || 'A'} vs ${teamB?.ticker || 'B'} → Picked: ${selected?.ticker || selectedId}`
      );

      picks.push({
        roundDecisionId: fixture.id,
        assetId: selectedId,
      });
    }

    // Step 8: Submit all picks
    logger.info(`📤 Submitting ${picks.length} picks for round ${roundId}...`);
    const result = await submitPicks(roundId, picks);

    const newStatus = result?.round?.round?.status;
    logger.info(`✅ Picks submitted! New status: ${formatStatus(newStatus)}`);

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
  } catch (err) {
    const isSessionError = err.message.includes('SESSION_EXPIRED');
    logger.error(`${isSessionError ? '🔑' : '❌'} Vote failed: ${err.message}`);

    const details = {
      error: err.message,
      strategy,
      sessionExpired: isSessionError,
    };

    logVote(false, details);
    return { success: false, details };
  }
}
