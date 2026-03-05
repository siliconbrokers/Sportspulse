import type { WarningDTO } from '../dto/snapshot-header.js';

export class WarningCollector {
  private warnings: WarningDTO[] = [];

  add(code: string, severity: WarningDTO['severity'], message?: string, entityId?: string): void {
    this.warnings.push({ code, severity, message: message ?? null, entityId });
  }

  missingSignal(entityId: string, signalKey: string): void {
    this.add('MISSING_SIGNAL', 'WARN', `Signal ${signalKey} missing for ${entityId}`, entityId);
  }

  insufficientHistory(entityId: string, matchesUsed: number): void {
    this.add(
      'INSUFFICIENT_HISTORY',
      'INFO',
      `Only ${matchesUsed} matches available for form computation`,
      entityId,
    );
  }

  noUpcomingMatch(entityId: string): void {
    this.add('NO_UPCOMING_MATCH', 'INFO', 'No upcoming scheduled match', entityId);
  }

  layoutDegraded(): void {
    this.add('LAYOUT_DEGRADED', 'WARN', 'All layout weights are zero; using equal-area fallback');
  }

  staleData(message?: string): void {
    this.add('STALE_DATA', 'WARN', message ?? 'Serving cached snapshot due to build failure');
  }

  partialData(message?: string): void {
    this.add('PARTIAL_DATA', 'WARN', message ?? 'Some entities have incomplete data');
  }

  providerError(message?: string): void {
    this.add('PROVIDER_ERROR', 'ERROR', message ?? 'Provider data unavailable');
  }

  toArray(): WarningDTO[] {
    return [...this.warnings];
  }

  get length(): number {
    return this.warnings.length;
  }
}
