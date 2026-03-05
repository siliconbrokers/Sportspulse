import type { DashboardSnapshotDTO } from '@sportpulse/snapshot';

export interface ComparisonResult {
  pass: boolean;
  layer: 'semantic' | 'contract' | 'geometry';
  message: string;
}

export function assertSemanticMatch(
  actual: DashboardSnapshotDTO,
  expected: DashboardSnapshotDTO,
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  // Policy identity
  if (actual.header.policyKey !== expected.header.policyKey) {
    results.push({ pass: false, layer: 'semantic', message: `policyKey: ${actual.header.policyKey} !== ${expected.header.policyKey}` });
  }
  if (actual.header.policyVersion !== expected.header.policyVersion) {
    results.push({ pass: false, layer: 'semantic', message: `policyVersion: ${actual.header.policyVersion} !== ${expected.header.policyVersion}` });
  }

  // Team ordering
  const actualIds = actual.teams.map((t) => t.teamId);
  const expectedIds = expected.teams.map((t) => t.teamId);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    results.push({ pass: false, layer: 'semantic', message: `Team ordering differs: ${JSON.stringify(actualIds)} vs ${JSON.stringify(expectedIds)}` });
  }

  // Score fields per team
  for (let i = 0; i < expected.teams.length; i++) {
    const a = actual.teams[i];
    const e = expected.teams[i];
    if (!a || !e) continue;

    for (const field of ['rawScore', 'attentionScore', 'displayScore', 'layoutWeight'] as const) {
      if (a[field] !== e[field]) {
        results.push({ pass: false, layer: 'semantic', message: `${a.teamId}.${field}: ${a[field]} !== ${e[field]}` });
      }
    }
  }

  // Warnings (code + severity, ignore message text)
  const actualWarnings = actual.warnings.map((w) => `${w.code}:${w.severity}:${w.entityId ?? ''}`).sort();
  const expectedWarnings = expected.warnings.map((w) => `${w.code}:${w.severity}:${w.entityId ?? ''}`).sort();
  if (JSON.stringify(actualWarnings) !== JSON.stringify(expectedWarnings)) {
    results.push({ pass: false, layer: 'semantic', message: `Warnings differ:\n  actual: ${JSON.stringify(actualWarnings)}\n  expected: ${JSON.stringify(expectedWarnings)}` });
  }

  if (results.length === 0) {
    results.push({ pass: true, layer: 'semantic', message: 'Semantic match OK' });
  }

  return results;
}

export function assertContractMatch(
  actual: DashboardSnapshotDTO,
  expected: DashboardSnapshotDTO,
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  // Required header fields
  for (const field of ['competitionId', 'seasonId', 'buildNowUtc', 'timezone', 'policyKey', 'policyVersion', 'snapshotSchemaVersion'] as const) {
    if (actual.header[field] === undefined || actual.header[field] === null) {
      results.push({ pass: false, layer: 'contract', message: `Missing header.${field}` });
    }
  }

  // Teams count
  if (actual.teams.length !== expected.teams.length) {
    results.push({ pass: false, layer: 'contract', message: `Team count: ${actual.teams.length} !== ${expected.teams.length}` });
  }

  // Required team fields
  for (const team of actual.teams) {
    for (const field of ['teamId', 'teamName', 'rawScore', 'attentionScore', 'displayScore', 'layoutWeight', 'rect'] as const) {
      if ((team as Record<string, unknown>)[field] === undefined) {
        results.push({ pass: false, layer: 'contract', message: `Missing ${team.teamId}.${field}` });
      }
    }
  }

  if (results.length === 0) {
    results.push({ pass: true, layer: 'contract', message: 'Contract match OK' });
  }

  return results;
}

export function assertGeometryMatch(
  actual: DashboardSnapshotDTO,
  expected: DashboardSnapshotDTO,
): ComparisonResult[] {
  const results: ComparisonResult[] = [];

  for (let i = 0; i < expected.teams.length; i++) {
    const a = actual.teams[i];
    const e = expected.teams[i];
    if (!a || !e) continue;

    for (const dim of ['x', 'y', 'w', 'h'] as const) {
      if (a.rect[dim] !== e.rect[dim]) {
        results.push({
          pass: false,
          layer: 'geometry',
          message: `${a.teamId}.rect.${dim}: ${a.rect[dim]} !== ${e.rect[dim]}`,
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({ pass: true, layer: 'geometry', message: 'Geometry match OK' });
  }

  return results;
}
