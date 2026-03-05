import { EventStatus } from '../model/enums.js';

/**
 * Validates event status transitions per Event Lifecycle Spec §4.
 *
 * Allowed transitions: §4.1 standard + §4.2 exceptional + §4.3 corrections.
 * Forbidden transitions: §4.3 (CANCELED→IN_PROGRESS, CANCELED→FINISHED, FINISHED→IN_PROGRESS).
 */

const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  // §4.1 Standard
  `${EventStatus.TBD}->${EventStatus.SCHEDULED}`,
  `${EventStatus.SCHEDULED}->${EventStatus.IN_PROGRESS}`,
  `${EventStatus.IN_PROGRESS}->${EventStatus.FINISHED}`,

  // §4.2 Exceptional
  `${EventStatus.SCHEDULED}->${EventStatus.POSTPONED}`,
  `${EventStatus.SCHEDULED}->${EventStatus.CANCELED}`,
  `${EventStatus.POSTPONED}->${EventStatus.SCHEDULED}`,
  `${EventStatus.POSTPONED}->${EventStatus.CANCELED}`,
  `${EventStatus.IN_PROGRESS}->${EventStatus.POSTPONED}`,
  `${EventStatus.IN_PROGRESS}->${EventStatus.CANCELED}`,

  // §4.3 Corrections
  `${EventStatus.FINISHED}->${EventStatus.FINISHED}`,
  `${EventStatus.FINISHED}->${EventStatus.CANCELED}`,
  `${EventStatus.FINISHED}->${EventStatus.POSTPONED}`,
]);

const FORBIDDEN_TRANSITIONS: ReadonlySet<string> = new Set([
  `${EventStatus.CANCELED}->${EventStatus.IN_PROGRESS}`,
  `${EventStatus.CANCELED}->${EventStatus.FINISHED}`,
  `${EventStatus.FINISHED}->${EventStatus.IN_PROGRESS}`,
]);

export type TransitionResult =
  | { allowed: true }
  | { allowed: false; reason: 'forbidden' | 'unknown' };

export function validateTransition(from: EventStatus, to: EventStatus): TransitionResult {
  // Same status is a no-op (always allowed), except FINISHED→FINISHED which is a score correction
  if (from === to && from !== EventStatus.FINISHED) {
    return { allowed: true };
  }

  const key = `${from}->${to}`;

  if (FORBIDDEN_TRANSITIONS.has(key)) {
    return { allowed: false, reason: 'forbidden' };
  }

  if (ALLOWED_TRANSITIONS.has(key)) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'unknown' };
}
