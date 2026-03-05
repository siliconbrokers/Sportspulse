export const SignalKey = {
  FORM_POINTS_LAST_5: 'FORM_POINTS_LAST_5',
  NEXT_MATCH_HOURS: 'NEXT_MATCH_HOURS',
} as const;

export type SignalKey = (typeof SignalKey)[keyof typeof SignalKey];

export const SignalEntityKind = {
  TEAM: 'TEAM',
  MATCH: 'MATCH',
} as const;

export type SignalEntityKind = (typeof SignalEntityKind)[keyof typeof SignalEntityKind];

export interface SignalRegistryEntry {
  key: SignalKey;
  entityKind: SignalEntityKind;
  unit: 'ratio' | 'points' | 'hours' | 'count' | 'unknown';
  description: string;
}

export const SIGNAL_REGISTRY: readonly SignalRegistryEntry[] = [
  {
    key: SignalKey.FORM_POINTS_LAST_5,
    entityKind: SignalEntityKind.TEAM,
    unit: 'points',
    description: 'Points from last 5 finished matches (W=3, D=1, L=0), normalized to [0..1]',
  },
  {
    key: SignalKey.NEXT_MATCH_HOURS,
    entityKind: SignalEntityKind.TEAM,
    unit: 'hours',
    description: 'Hours until next scheduled match, inverse-normalized to [0..1] with 168h horizon',
  },
] as const;
