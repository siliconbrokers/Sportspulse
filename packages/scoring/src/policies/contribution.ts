export interface ContributionDTO {
  signalKey: string;
  rawValue?: number;
  normValue: number;
  weight: number;
  contribution: number;
  notes?: string;
}

/**
 * Sort contributions per scoring-policy spec:
 * 1. |contribution| descending
 * 2. signalKey ascending (tie-break)
 */
export function sortContributions(contributions: ContributionDTO[]): ContributionDTO[] {
  return [...contributions].sort((a, b) => {
    const diff = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (diff !== 0) return diff;
    return a.signalKey.localeCompare(b.signalKey);
  });
}
