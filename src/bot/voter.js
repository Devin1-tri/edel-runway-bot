import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger, { logVote, logSeparator } from '../utils/logger.js';
import { saveSession } from '../auth/session.js';

/**
 * Take a screenshot with timestamp
 */
async function takeScreenshot(page, label = 'vote') {
  if (!config.saveScreenshots) return null;

  if (!fs.existsSync(config.screenshotDir)) {
    fs.mkdirSync(config.screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${label}_${timestamp}.png`;
  const filepath = path.join(config.screenshotDir, filename);

  await page.screenshot({ path: filepath, fullPage: true });
  logger.debug(`📸 Screenshot saved: ${filename}`);
  return filepath;
}

/**
 * Wait for listing calls page to fully load
 */
async function waitForPageReady(page) {
  // Wait for skeleton loaders to disappear (animate-pulse elements)
  try {
    await page.waitForFunction(
      () => {
        const skeletons = document.querySelectorAll('.animate-pulse');
        return skeletons.length === 0;
      },
      { timeout: 15000 }
    );
  } catch {
    logger.debug('Skeleton loaders may still be present, continuing...');
  }

  // Additional wait for dynamic content
  await page.waitForTimeout(2000);
}

/**
 * Detect available voting options on the listing calls page.
 * Adapts to the DOM structure dynamically.
 *
 * @param {import('playwright').Page} page
 * @returns {Array<{element: import('playwright').ElementHandle, name: string, votes: number|null, index: number}>}
 */
async function detectVotingOptions(page) {
  const options = [];

  // Strategy 1: Look for cards/buttons that appear to be selectable voting options
  // The GameView component renders head-to-head asset comparisons
  const selectors = [
    // Common patterns for voting cards in DeFi/crypto UIs
    '[data-testid*="vote"]',
    '[data-testid*="call"]',
    '[data-testid*="asset"]',
    '[data-testid*="option"]',
    'button[class*="call"]',
    'button[class*="vote"]',
    'button[class*="asset"]',
    '[role="button"][class*="card"]',
    // Look for clickable cards in the game view area
    'main button:not([disabled])',
    'main [role="button"]:not([disabled])',
  ];

  for (const selector of selectors) {
    try {
      const elements = await page.$$(selector);
      if (elements.length >= 2) {
        logger.debug(`Found ${elements.length} voting elements with selector: ${selector}`);

        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const text = await el.innerText().catch(() => '');
          const name = text.split('\n')[0]?.trim() || `Option ${i + 1}`;

          // Try to extract vote count from text
          const voteMatch = text.match(/(\d+[\d,]*)\s*(votes?|%)/i);
          const votes = voteMatch ? parseInt(voteMatch[1].replace(/,/g, ''), 10) : null;

          options.push({ element: el, name, votes, index: i });
        }
        break; // Found options, stop searching
      }
    } catch {
      continue;
    }
  }

  // Strategy 2: If no specific elements found, look for the general grid layout
  // The listing-calls page uses "grid gap-5 md:grid-cols-3" for cards
  if (options.length < 2) {
    try {
      // Look for interactive elements within card-like containers
      const cards = await page.$$('main .grid > div, main .grid > button, main .grid > a');
      const clickableCards = [];

      for (const card of cards) {
        const isVisible = await card.isVisible().catch(() => false);
        const box = await card.boundingBox().catch(() => null);
        if (isVisible && box && box.height > 50) {
          // Check if card has a clickable nature
          const tag = await card.evaluate((el) => el.tagName.toLowerCase());
          const hasOnClick = await card.evaluate(
            (el) => el.onclick !== null || el.getAttribute('role') === 'button' || el.style.cursor === 'pointer'
          );
          const innerButtons = await card.$$('button');

          if (tag === 'button' || tag === 'a' || hasOnClick || innerButtons.length > 0) {
            const text = await card.innerText().catch(() => '');
            const name = text.split('\n')[0]?.trim() || `Card ${clickableCards.length + 1}`;
            const voteMatch = text.match(/(\d+[\d,]*)\s*(votes?|%)/i);
            const votes = voteMatch ? parseInt(voteMatch[1].replace(/,/g, ''), 10) : null;

            // If card itself isn't a button, use inner button
            const clickTarget = innerButtons.length > 0 ? innerButtons[0] : card;
            clickableCards.push({ element: clickTarget, name, votes, index: clickableCards.length });
          }
        }
      }

      if (clickableCards.length >= 2) {
        options.push(...clickableCards);
        logger.debug(`Found ${clickableCards.length} voting cards via grid scan`);
      }
    } catch (err) {
      logger.debug(`Grid scan failed: ${err.message}`);
    }
  }

  // Strategy 3: Ultimate fallback - find all prominent buttons on the page
  if (options.length < 2) {
    try {
      const allButtons = await page.$$('main button:not([disabled])');
      const voteButtons = [];

      for (const btn of allButtons) {
        const text = await btn.innerText().catch(() => '');
        const isVisible = await btn.isVisible().catch(() => false);
        const box = await btn.boundingBox().catch(() => null);

        // Filter for substantial buttons (not small utility buttons)
        if (isVisible && box && box.height > 35 && box.width > 80 && text.length > 0) {
          // Exclude navigation/utility buttons
          const lowerText = text.toLowerCase();
          if (
            !lowerText.includes('menu') &&
            !lowerText.includes('settings') &&
            !lowerText.includes('profile') &&
            !lowerText.includes('logout') &&
            !lowerText.includes('close') &&
            !lowerText.includes('cancel')
          ) {
            voteButtons.push({
              element: btn,
              name: text.split('\n')[0]?.trim() || `Button ${voteButtons.length + 1}`,
              votes: null,
              index: voteButtons.length,
            });
          }
        }
      }

      if (voteButtons.length >= 2) {
        options.push(...voteButtons.slice(0, 6)); // Max 6 options
        logger.debug(`Found ${voteButtons.length} potential vote buttons via fallback scan`);
      }
    } catch (err) {
      logger.debug(`Button fallback scan failed: ${err.message}`);
    }
  }

  return options;
}

/**
 * Smart voting strategy: analyze available data to pick the best option
 */
function smartSelect(options) {
  // If we have vote count data, pick the one with MORE votes (momentum/popular choice)
  const withVotes = options.filter((o) => o.votes !== null);

  if (withVotes.length >= 2) {
    // Sort by votes descending - pick the most popular (momentum strategy)
    const sorted = [...withVotes].sort((a, b) => b.votes - a.votes);
    logger.info(`🧠 Smart: Memilih "${sorted[0].name}" (${sorted[0].votes} votes) - momentum strategy`);
    return sorted[0];
  }

  // Fallback: no vote data available, pick randomly
  logger.info('🧠 Smart: Tidak ada data votes, menggunakan random');
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Select voting option based on configured strategy
 */
function selectOption(options, strategy) {
  if (options.length === 0) return null;

  switch (strategy) {
    case 'first':
      logger.info(`📌 Strategy "first": Memilih "${options[0].name}"`);
      return options[0];

    case 'second':
      if (options.length < 2) return options[0];
      logger.info(`📌 Strategy "second": Memilih "${options[1].name}"`);
      return options[1];

    case 'smart':
      return smartSelect(options);

    case 'random':
    default: {
      const idx = Math.floor(Math.random() * options.length);
      logger.info(`🎲 Strategy "random": Memilih "${options[idx].name}" (index: ${idx})`);
      return options[idx];
    }
  }
}

/**
 * Look for and click a submit/confirm button after selecting an option
 */
async function submitVote(page) {
  // Common submit button patterns
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button:has-text("Vote")',
    'button:has-text("Cast")',
    'button:has-text("send")',
    'button:has-text("submit")',
    'button:has-text("confirm")',
    'button:has-text("vote")',
    '[data-testid*="submit"]',
    '[data-testid*="confirm"]',
  ];

  for (const selector of submitSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        const isVisible = await btn.isVisible().catch(() => false);
        const isEnabled = await btn.isEnabled().catch(() => false);
        if (isVisible && isEnabled) {
          const text = await btn.innerText().catch(() => 'Submit');
          logger.info(`📤 Clicking submit button: "${text.trim()}"`);
          await btn.click();
          await page.waitForTimeout(2000);
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  logger.debug('No separate submit button found (vote may have been submitted on click)');
  return false;
}

/**
 * Check if voting has already been done (already voted state)
 */
async function checkAlreadyVoted(page) {
  const indicators = [
    // Common "already voted" indicators
    'text=/already voted/i',
    'text=/vote submitted/i',
    'text=/you voted/i',
    'text=/voted/i',
    'text=/your pick/i',
    'text=/selected/i',
    'text=/come back/i',
    'text=/next round/i',
  ];

  for (const selector of indicators) {
    try {
      const el = await page.$(selector);
      if (el) {
        const isVisible = await el.isVisible().catch(() => false);
        if (isVisible) {
          const text = await el.innerText().catch(() => '');
          return { alreadyVoted: true, message: text.trim() };
        }
      }
    } catch {
      continue;
    }
  }

  return { alreadyVoted: false, message: null };
}

/**
 * Handle any confirmation dialogs/modals that appear after voting
 */
async function handleConfirmationModal(page) {
  await page.waitForTimeout(1000);

  // Look for modal confirm buttons
  const modalConfirmSelectors = [
    '.modal button:has-text("Confirm")',
    '.modal button:has-text("Yes")',
    '.modal button:has-text("OK")',
    '[role="dialog"] button:has-text("Confirm")',
    '[role="dialog"] button:has-text("Yes")',
    '[role="alertdialog"] button:has-text("OK")',
    'dialog button:has-text("Confirm")',
  ];

  for (const selector of modalConfirmSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          logger.info('📋 Confirmation modal detected, confirming...');
          await btn.click();
          await page.waitForTimeout(2000);
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Main voting function — the core of the bot
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @returns {{ success: boolean, details: object }}
 */
export async function performVote(page, context) {
  const strategy = config.voteStrategy;
  logSeparator();
  logger.info(`🗳️  Starting vote attempt | Strategy: ${strategy}`);
  logger.info(`📍 Navigating to ${config.listingCallsUrl}`);

  try {
    // Navigate to listing calls page
    await page.goto(config.listingCallsUrl, { waitUntil: 'networkidle' });

    // Check for login redirect
    if (page.url().includes('/login') || page.url().includes('/register')) {
      return {
        success: false,
        details: { error: 'Session expired - redirected to login', strategy },
      };
    }

    // Wait for page to fully load
    await waitForPageReady(page);
    await takeScreenshot(page, 'before-vote');

    // Check if already voted
    const { alreadyVoted, message } = await checkAlreadyVoted(page);
    if (alreadyVoted) {
      logger.info(`ℹ️  Already voted: "${message}"`);
      await takeScreenshot(page, 'already-voted');
      return {
        success: true,
        details: { asset: 'N/A', strategy, round: 'N/A', note: `Already voted: ${message}` },
      };
    }

    // Detect voting options
    logger.info('🔍 Scanning for voting options...');
    const options = await detectVotingOptions(page);

    if (options.length === 0) {
      logger.warn('⚠️  No voting options found on the page.');
      await takeScreenshot(page, 'no-options');
      return {
        success: false,
        details: { error: 'No voting options found', strategy },
      };
    }

    logger.info(`📊 Found ${options.length} voting options:`);
    options.forEach((opt, i) => {
      const votesStr = opt.votes !== null ? ` (${opt.votes} votes)` : '';
      logger.info(`   ${i + 1}. ${opt.name}${votesStr}`);
    });

    // Select option based on strategy
    const selected = selectOption(options, strategy);
    if (!selected) {
      return {
        success: false,
        details: { error: 'Strategy returned no selection', strategy },
      };
    }

    // Click the selected option
    logger.info(`👆 Clicking: "${selected.name}"`);
    await selected.element.click();
    await page.waitForTimeout(1500);

    // Handle confirmation modal if any
    await handleConfirmationModal(page);

    // Try to submit vote (some UIs require a separate submit button)
    await submitVote(page);

    // Wait for response
    await page.waitForTimeout(3000);
    await takeScreenshot(page, 'after-vote');

    // Refresh session after successful action
    await saveSession(context);

    const details = {
      asset: selected.name,
      strategy,
      round: new Date().toISOString().split('T')[0],
    };

    logVote(true, details);
    return { success: true, details };
  } catch (err) {
    logger.error(`Vote attempt failed: ${err.message}`);
    await takeScreenshot(page, 'error');

    const details = { error: err.message, strategy };
    logVote(false, details);
    return { success: false, details };
  }
}
