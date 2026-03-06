import type { SignalDTO } from '@sportpulse/signals';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DISPLAY_RULES_KEY = 'sportpulse.display.dummies';
export const DISPLAY_RULES_VERSION = 1;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export type ChipLevel = 'INFO' | 'OK' | 'WARN' | 'HOT' | 'ERROR' | 'UNKNOWN';

export interface DisplayChipDTO {
  icon: string;
  label: string;
  level: ChipLevel;
  kind: string;
}

export interface ExplainLineDTO {
  text: string;
  kind: string;
}

export interface DisplayHintsDTO {
  formChip?: DisplayChipDTO;
  nextMatchChip?: DisplayChipDTO;
  deltaChip?: DisplayChipDTO;
  explainLine?: ExplainLineDTO;
}

export interface DisplayRulesDTO {
  displayRulesKey: string;
  displayRulesVersion: number;
}

export const DISPLAY_RULES: DisplayRulesDTO = {
  displayRulesKey: DISPLAY_RULES_KEY,
  displayRulesVersion: DISPLAY_RULES_VERSION,
};

// ─── Form chip ────────────────────────────────────────────────────────────────

/** §9.1 — maps FORM_POINTS_LAST_5 signal to a form chip. Always returns a chip. */
export function mapFormChip(signals: readonly SignalDTO[]): DisplayChipDTO {
  const signal = signals.find((s) => s.key === 'FORM_POINTS_LAST_5');

  if (!signal || signal.quality.missing) {
    return { icon: '⚠️', label: 'Sin datos', level: 'UNKNOWN', kind: 'FORM_MISSING' };
  }

  const rawPoints =
    typeof signal.params?.rawPoints === 'number' ? (signal.params.rawPoints as number) : undefined;

  if (rawPoints !== undefined) {
    if (rawPoints >= 12) return { icon: '🔥', label: 'Picante', level: 'HOT', kind: 'FORM_HOT' };
    if (rawPoints >= 8) return { icon: '✅', label: 'Viene bien', level: 'OK', kind: 'FORM_GOOD' };
    if (rawPoints >= 5) return { icon: '➖', label: 'Normal', level: 'INFO', kind: 'FORM_NORMAL' };
    return { icon: '❌', label: 'Viene mal', level: 'WARN', kind: 'FORM_BAD' };
  }

  // Fallback: use normValue (§9.1)
  const norm = signal.value;
  if (norm >= 0.8) return { icon: '🔥', label: 'Picante', level: 'HOT', kind: 'FORM_HOT' };
  if (norm >= 0.53) return { icon: '✅', label: 'Viene bien', level: 'OK', kind: 'FORM_GOOD' };
  if (norm >= 0.33) return { icon: '➖', label: 'Normal', level: 'INFO', kind: 'FORM_NORMAL' };
  return { icon: '❌', label: 'Viene mal', level: 'WARN', kind: 'FORM_BAD' };
}

// ─── Time chip ────────────────────────────────────────────────────────────────

/** §9.2 — maps NEXT_MATCH_HOURS signal to a time chip. Always returns a chip. */
export function mapTimeChip(signals: readonly SignalDTO[]): DisplayChipDTO {
  const signal = signals.find((s) => s.key === 'NEXT_MATCH_HOURS');

  if (!signal || signal.quality.missing) {
    return { icon: '⚠️', label: 'Sin fecha', level: 'UNKNOWN', kind: 'TIME_UNKNOWN' };
  }

  const hours =
    typeof signal.params?.hours === 'number' ? (signal.params.hours as number) : undefined;

  if (hours === undefined) {
    return { icon: '⚠️', label: 'Sin fecha', level: 'UNKNOWN', kind: 'TIME_UNKNOWN' };
  }

  if (hours <= 0) {
    return { icon: '⏱️', label: 'Ya empezó', level: 'WARN', kind: 'TIME_STARTED' };
  }
  if (hours < 24) {
    return {
      icon: '⏳',
      label: `Hoy · en ${Math.ceil(hours)} h`,
      level: 'HOT',
      kind: 'TIME_TODAY_HOURS',
    };
  }
  if (hours < 48) {
    return {
      icon: '⏳',
      label: `Mañana · en ${Math.ceil(hours)} h`,
      level: 'OK',
      kind: 'TIME_TOMORROW_HOURS',
    };
  }
  if (hours <= 168) {
    return {
      icon: '📅',
      label: `En ${Math.round(hours / 24)} días`,
      level: 'INFO',
      kind: 'TIME_DAYS',
    };
  }
  return {
    icon: '🗓️',
    label: `En ${Math.round(hours / 24)} días`,
    level: 'INFO',
    kind: 'TIME_LATER_DAYS',
  };
}

// ─── Top-level mapper ─────────────────────────────────────────────────────────

/** Maps all display hints for a team tile from its computed signals. */
export function mapDisplayHints(signals: readonly SignalDTO[]): DisplayHintsDTO {
  return {
    formChip: mapFormChip(signals),
    nextMatchChip: mapTimeChip(signals),
  };
}
