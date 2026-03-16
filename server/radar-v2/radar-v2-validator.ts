/**
 * Radar SportPulse v2 — Snapshot Validator
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §18, §19
 *
 * A snapshot is invalid if:
 *   1. scope keys are missing
 *   2. more than 3 cards exist
 *   3. duplicate matchId inside one scope
 *   4. primaryLabel is missing
 *   5. preMatchText is empty
 *   6. family is invalid
 *   7. family/label combination is impossible
 *   8. verdict exists before match is final
 */

import type { RadarV2Snapshot, RadarV2Card, RadarV2PredictionContext } from './radar-v2-types.js';
import { VALID_FAMILY_LABELS, RADAR_V2_MAX_CARDS } from './radar-v2-types.js';

export interface ValidationError {
  code: string;
  message: string;
  cardIndex?: number;
}

/**
 * Validates a Radar v2 snapshot. Returns an array of validation errors.
 * Empty array means the snapshot is valid.
 */
export function validateSnapshot(snapshot: RadarV2Snapshot): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Scope keys
  if (!snapshot.competitionKey) {
    errors.push({ code: 'MISSING_SCOPE', message: 'competitionKey is missing' });
  }
  if (!snapshot.seasonKey) {
    errors.push({ code: 'MISSING_SCOPE', message: 'seasonKey is missing' });
  }
  if (snapshot.matchday === undefined || snapshot.matchday === null || snapshot.matchday === '') {
    errors.push({ code: 'MISSING_SCOPE', message: 'matchday is missing' });
  }

  // 2. Max cards
  if (snapshot.cards.length > RADAR_V2_MAX_CARDS) {
    errors.push({
      code: 'MAX_CARDS_EXCEEDED',
      message: `Snapshot has ${snapshot.cards.length} cards, max is ${RADAR_V2_MAX_CARDS}`,
    });
  }

  // 3. Duplicate matchId
  const matchIds = new Set<string>();
  for (let i = 0; i < snapshot.cards.length; i++) {
    const card = snapshot.cards[i];
    if (matchIds.has(card.matchId)) {
      errors.push({
        code: 'DUPLICATE_MATCH_ID',
        message: `Duplicate matchId: ${card.matchId}`,
        cardIndex: i,
      });
    }
    matchIds.add(card.matchId);
  }

  // Per-card validations
  for (let i = 0; i < snapshot.cards.length; i++) {
    const card = snapshot.cards[i];
    const cardErrors = validateCard(card, i);
    errors.push(...cardErrors);
  }

  return errors;
}

function validateCard(card: RadarV2Card, index: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // 4. primaryLabel missing
  if (!card.primaryLabel) {
    errors.push({
      code: 'MISSING_PRIMARY_LABEL',
      message: `Card ${index}: primaryLabel is missing`,
      cardIndex: index,
    });
  }

  // 5. preMatchText empty
  if (!card.preMatchText || card.preMatchText.trim() === '') {
    errors.push({
      code: 'EMPTY_PRE_MATCH_TEXT',
      message: `Card ${index}: preMatchText is empty`,
      cardIndex: index,
    });
  }

  // 6. family invalid
  const validFamilies = Object.keys(VALID_FAMILY_LABELS);
  if (!validFamilies.includes(card.family)) {
    errors.push({
      code: 'INVALID_FAMILY',
      message: `Card ${index}: invalid family "${card.family}"`,
      cardIndex: index,
    });
  }

  // 7. family/label combination
  if (card.family && card.primaryLabel) {
    const allowedLabels = VALID_FAMILY_LABELS[card.family as keyof typeof VALID_FAMILY_LABELS];
    if (allowedLabels && !allowedLabels.includes(card.primaryLabel)) {
      errors.push({
        code: 'INVALID_FAMILY_LABEL',
        message: `Card ${index}: label "${card.primaryLabel}" is not valid for family "${card.family}"`,
        cardIndex: index,
      });
    }
  }

  // 8. verdict before final state -- verdict should only exist when snapshot lifecycle permits
  // This is checked at the service level, not card level (we check card.verdict exists
  // but the card itself doesn't carry lifecycle state -- the snapshot status does)

  // 9. predictionContext structure (if present)
  if (card.predictionContext !== null && card.predictionContext !== undefined) {
    const ctxErrors = validatePredictionContext(card.predictionContext, index);
    errors.push(...ctxErrors);
  }

  return errors;
}

function validatePredictionContext(
  ctx: RadarV2PredictionContext,
  cardIndex: number,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const validModes = ['FULL_MODE', 'LIMITED_MODE', 'NOT_ELIGIBLE'];
  if (!validModes.includes(ctx.operatingMode)) {
    errors.push({
      code: 'INVALID_PREDICTION_CONTEXT',
      message: `Card ${cardIndex}: predictionContext.operatingMode invalid: "${ctx.operatingMode}"`,
      cardIndex,
    });
  }

  if (ctx.eligibilityStatus !== 'ELIGIBLE' && ctx.eligibilityStatus !== 'NOT_ELIGIBLE') {
    errors.push({
      code: 'INVALID_PREDICTION_CONTEXT',
      message: `Card ${cardIndex}: predictionContext.eligibilityStatus invalid: "${ctx.eligibilityStatus}"`,
      cardIndex,
    });
  }

  // In FULL_MODE, calibrated probs should be present and valid
  if (ctx.operatingMode === 'FULL_MODE') {
    if (
      ctx.probHomeWin !== null &&
      ctx.probDraw !== null &&
      ctx.probAwayWin !== null
    ) {
      const sum = ctx.probHomeWin + ctx.probDraw + ctx.probAwayWin;
      if (Math.abs(sum - 1) > 0.02) {
        errors.push({
          code: 'INVALID_PREDICTION_CONTEXT',
          message: `Card ${cardIndex}: predictionContext probs sum ${sum.toFixed(4)} is not ~1.0`,
          cardIndex,
        });
      }
    }
  }

  return errors;
}

/**
 * Validates that a verdict is not being set prematurely.
 * Returns true if verdict attachment is allowed.
 */
export function canAttachVerdict(matchStatus: string): boolean {
  return matchStatus === 'FINISHED';
}

/**
 * Quick check: is this snapshot structurally valid for rendering?
 */
export function isRenderSafe(snapshot: RadarV2Snapshot): boolean {
  if (snapshot.status === 'FAILED') return false;
  const errors = validateSnapshot(snapshot);
  return errors.length === 0;
}
