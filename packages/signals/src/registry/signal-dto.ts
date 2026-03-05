import type { SignalKey, SignalEntityKind } from './signal-keys.js';

export interface SignalQuality {
  source: 'canonical_ingested' | 'canonical_derived';
  freshnessUtc?: string;
  confidence?: number;
  missing: boolean;
  notes?: string;
}

export interface SignalDTO {
  key: SignalKey;
  entityKind: SignalEntityKind;
  entityId: string;
  value: number;
  unit: 'ratio' | 'points' | 'hours' | 'count' | 'unknown';
  params?: Record<string, unknown>;
  quality: SignalQuality;
  explain?: string;
}
