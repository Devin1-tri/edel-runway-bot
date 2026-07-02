/**
 * Voting strategies for Edel Listing Calls.
 *
 * Each strategy takes two asset IDs and returns which one to pick.
 * Assets are identified by their Edel asset IDs (e.g. "asset-NVDA").
 */

// ── Market Cap ranking (approximate, July 2025) ──────────────
// Higher number = higher market cap = preferred pick
const MARKET_CAP_RANK = {
  'asset-AAPL':  100, // Apple
  'asset-NVDA':   99, // Nvidia
  'asset-MSFT':   98, // Microsoft
  'asset-GOOGL':  97, // Alphabet
  'asset-AMZN':   96, // Amazon
  'asset-META':   95, // Meta
  'asset-TSLA':   90, // Tesla
  'asset-BRK.B':  89, // Berkshire
  'asset-BRK.A':  89,
  'asset-TSM':    88, // TSMC
  'asset-AVGO':   87, // Broadcom
  'asset-JPM':    85, // JPMorgan
  'asset-V':      84, // Visa
  'asset-MA':     83, // Mastercard
  'asset-LLY':    82, // Eli Lilly
  'asset-JNJ':    80, // J&J
  'asset-WMT':    79, // Walmart
  'asset-UNH':    78, // UnitedHealth
  'asset-ORCL':   77, // Oracle
  'asset-COST':   76, // Costco
  'asset-HD':     75, // Home Depot
  'asset-PG':     74, // Procter & Gamble
  'asset-ABBV':   73, // AbbVie
  'asset-MRK':    72, // Merck
  'asset-CVX':    71, // Chevron
  'asset-KO':     70, // Coca-Cola
  'asset-PEP':    69, // PepsiCo
  'asset-XOM':    68, // ExxonMobil
  'asset-BAC':    67, // Bank of America
  'asset-AMD':    66, // AMD
  'asset-ADBE':   65, // Adobe
  'asset-CRM':    64, // Salesforce
  'asset-NFLX':   63, // Netflix
  'asset-TXN':    62, // Texas Instruments
  'asset-QCOM':   61, // Qualcomm
  'asset-INTC':   60, // Intel
  'asset-CSCO':   59, // Cisco
  'asset-IBM':    58, // IBM
  'asset-GE':     57, // GE Aerospace
  'asset-GEV':    56, // GE Vernova
  'asset-CAT':    55, // Caterpillar
  'asset-BA':     54, // Boeing
  'asset-RTX':    53, // RTX Corp
  'asset-PLTR':   50, // Palantir
  'asset-SNOW':   48, // Snowflake
  'asset-LRCX':   52, // Lam Research
  'asset-KLAC':   51, // KLA Corp
  'asset-LIN':    64, // Linde
  'asset-APD':    45, // Air Products
  'asset-DE':     50, // Deere
  'asset-UPS':    48, // UPS
  'asset-GS':     66, // Goldman Sachs
  'asset-MS':     60, // Morgan Stanley
  'asset-BLK':    65, // BlackRock
  'asset-SCHW':   55, // Charles Schwab
  'asset-AXP':    58, // American Express
  'asset-ISRG':   60, // Intuitive Surgical
  'asset-ABT':    62, // Abbott Labs
  'asset-DHR':    58, // Danaher
  'asset-TMO':    57, // Thermo Fisher
  'asset-ACN':    55, // Accenture
  'asset-NOW':    62, // ServiceNow
  'asset-INTU':   58, // Intuit
  'asset-AMGN':   50, // Amgen
  'asset-GILD':   48, // Gilead
  'asset-PFE':    40, // Pfizer
  'asset-BMY':    42, // Bristol-Myers
  'asset-COP':    55, // ConocoPhillips
  'asset-EOG':    50, // EOG Resources
  'asset-SLB':    45, // Schlumberger
  'asset-MCD':    60, // McDonald's
  'asset-SBUX':   50, // Starbucks
  'asset-NKE':    45, // Nike
  'asset-TGT':    38, // Target
  'asset-DIS':    48, // Disney
  'asset-CMCSA':  40, // Comcast
  'asset-VZ':     42, // Verizon
  'asset-T':      40, // AT&T
};

/**
 * Market Cap strategy: pick the asset with higher market cap.
 * Falls back to random if neither asset is in the ranking.
 */
export function marketcapStrategy(assetAId, assetBId, assetMap) {
  const rankA = MARKET_CAP_RANK[assetAId] ?? 0;
  const rankB = MARKET_CAP_RANK[assetBId] ?? 0;

  if (rankA === 0 && rankB === 0) {
    // Both unknown — fall back to random
    return Math.random() < 0.5 ? assetAId : assetBId;
  }

  // Pick the one with higher rank (higher market cap)
  return rankA >= rankB ? assetAId : assetBId;
}

/**
 * Popular strategy: pick based on brand recognition / hype tier.
 * Prioritizes: AI/tech hype > mega cap > large cap > rest
 */
const HYPE_TIER = {
  // Tier 1: AI / Hype kings
  'asset-NVDA':  10,
  'asset-PLTR':   9,
  'asset-TSLA':   9,
  'asset-AMD':    8,
  'asset-AMZN':   8,
  'asset-GOOGL':  8,
  'asset-META':   8,
  'asset-MSFT':   8,
  'asset-AAPL':   8,
  'asset-NFLX':   7,
  'asset-NOW':    7,
  'asset-SNOW':   7,
  'asset-CRM':    7,
  'asset-ISRG':   7,

  // Tier 2: Blue chips
  'asset-JPM':    6,
  'asset-V':      6,
  'asset-MA':     6,
  'asset-LLY':    6,
  'asset-AVGO':   6,
  'asset-XOM':    5,
  'asset-CVX':    5,
  'asset-JNJ':    5,
  'asset-WMT':    5,
  'asset-UNH':    5,
  'asset-ORCL':   5,
  'asset-HD':     5,
  'asset-COST':   5,
  'asset-KO':     4,
  'asset-PEP':    4,
  'asset-PG':     4,
  'asset-MRK':    4,
  'asset-ABBV':   4,

  // Tier 3: Everything else
  default: 2,
};

export function popularStrategy(assetAId, assetBId, assetMap) {
  const tierA = HYPE_TIER[assetAId] ?? HYPE_TIER.default;
  const tierB = HYPE_TIER[assetBId] ?? HYPE_TIER.default;

  if (tierA === tierB) {
    // Same tier — random
    return Math.random() < 0.5 ? assetAId : assetBId;
  }

  return tierA > tierB ? assetAId : assetBId;
}

/**
 * Underdog strategy: pick the LOWER market cap (contrarian).
 * The idea: smaller companies have more room to grow, and
 * the "underdog" narrative is popular in listing calls.
 */
export function underdogStrategy(assetAId, assetBId, assetMap) {
  const rankA = MARKET_CAP_RANK[assetAId] ?? 50;
  const rankB = MARKET_CAP_RANK[assetBId] ?? 50;

  if (rankA === rankB) {
    return Math.random() < 0.5 ? assetAId : assetBId;
  }

  // Pick the one with LOWER rank (smaller market cap = underdog)
  return rankA <= rankB ? assetAId : assetBId;
}

// ── Demand Index ranking (actual voting history from Edel) ──
// Updated from https://runway.edel.finance/demand-index
// Higher number = higher rank = more popular in listing calls
// Last updated: 2026-07-02
const DEMAND_RANK = {
  'asset-NVDA':  52, // #1  Score: 22,462,475
  'asset-TSLA':  51, // #2  Score: 21,217,576
  'asset-NFLX':  50, // #3  Score: 20,798,162
  'asset-AAPL':  49, // #4  Score: 20,394,774
  'asset-MSFT':  48, // #5  Score: 20,162,131
  'asset-META':  47, // #6  Score: 19,319,432
  'asset-AMZN':  46, // #7  Score: 19,255,530
  'asset-ORCL':  45, // #8  Score: 18,431,824
  'asset-MA':    44, // #9  Score: 17,713,438
  'asset-V':     43, // #10 Score: 17,672,121
  'asset-NDX':   42, // #11 Score: 17,074,933
  'asset-INTC':  41, // #12 Score: 16,317,025
  'asset-DELL':  40, // #13 Score: 14,970,343
  'asset-KO':    39, // #14 Score: 14,557,485
  'asset-BAC':   38, // #15 Score: 14,535,002
  'asset-SPX':   37, // #16 Score: 14,162,586
  'asset-AMD':   36, // #17 Score: 13,987,989
  'asset-JPM':   35, // #18 Score: 13,652,341
  'asset-QCOM':  34, // #19 Score: 13,515,357
  'asset-GOOGL': 33, // #20 Score: 13,487,242
  'asset-RTX':   32, // #21 Score: 12,948,965
  'asset-SNDK':  31, // #22 Score: 12,383,348
  'asset-MS':    30, // #23 Score: 12,308,924
  'asset-PLTR':  29, // #24 Score: 12,135,819
  'asset-MU':    28, // #25 Score: 11,664,394
  'asset-WMT':   27, // #26 Score: 11,213,780
  'asset-GS':    26, // #27 Score: 10,597,910
  'asset-TXN':   25, // #28 Score: 10,539,340
  'asset-IBM':   24, // #29 Score: 10,025,282
  'asset-AVGO':  23, // #30 Score:  9,816,371
  'asset-XOM':   22, // #31 Score:  8,999,680
  'asset-PM':    21, // #32 Score:  8,437,958
  'asset-PG':    20, // #33 Score:  8,429,023
  'asset-JNJ':   19, // #34 Score:  8,415,287
  'asset-COST':  18, // #35 Score:  8,305,325
  'asset-CAT':   17, // #36 Score:  8,042,227
  'asset-BRK.B': 16, // #37 Score:  7,937,580
  'asset-CVX':   15, // #38 Score:  7,741,495
  'asset-AMAT':  14, // #39 Score:  7,655,379
  'asset-CSCO':  13, // #40 Score:  7,574,656
  'asset-ABBV':  12, // #41 Score:  7,523,174
  'asset-WFC':   11, // #42 Score:  7,329,319
  'asset-UNH':   10, // #43 Score:  6,691,829
  'asset-LRCX':   9, // #44 Score:  6,639,145
  'asset-LLY':    8, // #45 Score:  6,536,151
  'asset-AZN':    7, // #46 Score:  6,255,955
  'asset-LIN':    6, // #47 Score:  5,754,225
  'asset-MRK':    5, // #48 Score:  5,446,314
  'asset-HD':     4, // #49 Score:  5,209,189
  'asset-KLAC':   3, // #50 Score:  4,758,150
  'asset-GEV':    2, // #51 Score:  4,489,132
  'asset-GE':     1, // #52 Score:  4,258,771
};

/**
 * Demand Index strategy: pick the asset ranked higher in Edel's Demand Index.
 * Uses actual voting history data — the asset that wins more often in listing calls.
 * Falls back to random if neither asset is in the ranking.
 */
export function demandStrategy(assetAId, assetBId, assetMap) {
  const rankA = DEMAND_RANK[assetAId] ?? 0;
  const rankB = DEMAND_RANK[assetBId] ?? 0;

  if (rankA === 0 && rankB === 0) {
    return Math.random() < 0.5 ? assetAId : assetBId;
  }

  // Pick the one with higher demand rank
  return rankA >= rankB ? assetAId : assetBId;
}

/**
 * Always-pick-A strategy for a specific ticker.
 * Set via ALWAYS_PICK env var (e.g. ALWAYS_PICK=NVDA).
 * If the ticker appears in a matchup, always pick it.
 * Otherwise falls back to random.
 */
export function alwaysPickStrategy(assetAId, assetBId, assetMap, targetTicker) {
  const tickerA = assetMap.get(assetAId)?.ticker;
  const tickerB = assetMap.get(assetBId)?.ticker;

  if (tickerA === targetTicker) return assetAId;
  if (tickerB === targetTicker) return assetBId;

  // Target not in this matchup — random
  return Math.random() < 0.5 ? assetAId : assetBId;
}

// ── Strategy registry ──────────────────────────
export const STRATEGIES = {
  random:    (a, b) => Math.random() < 0.5 ? a : b,
  smart:     (a, b) => Math.random() < 0.5 ? a : b, // same as random
  first:     (a, b) => a,
  second:    (a, b) => b,
  marketcap: marketcapStrategy,
  popular:   popularStrategy,
  underdog:  underdogStrategy,
  demand:    demandStrategy,
};

export function pickAsset(assetAId, assetBId, assetMap, strategy, opts = {}) {
  const fn = STRATEGIES[strategy];

  if (!fn) {
    // Check if it's an "always pick X" strategy
    if (strategy.startsWith('pick-')) {
      const ticker = strategy.replace('pick-', '').toUpperCase();
      return alwaysPickStrategy(assetAId, assetBId, assetMap, ticker);
    }
    // Unknown strategy — fallback to random
    return Math.random() < 0.5 ? assetAId : assetBId;
  }

  return fn(assetAId, assetBId, assetMap, opts);
}
