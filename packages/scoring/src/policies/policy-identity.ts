export interface PolicyIdentity {
  policyKey: string;
  policyVersion: number;
}

export interface PolicyWeightEntry {
  signalKey: string;
  weight: number;
  required: boolean;
}

export interface PolicyDefinition extends PolicyIdentity {
  entityKind: 'TEAM' | 'MATCH';
  rawScoreFormula: 'weighted_sum';
  weights: readonly PolicyWeightEntry[];
}

export const MVP_POLICY: PolicyDefinition = {
  policyKey: 'sportpulse.mvp.form-agenda',
  policyVersion: 1,
  entityKind: 'TEAM',
  rawScoreFormula: 'weighted_sum',
  weights: [
    { signalKey: 'FORM_POINTS_LAST_5', weight: 0.7, required: false },
    { signalKey: 'NEXT_MATCH_HOURS', weight: 0.3, required: false },
  ],
} as const;
