# Plan: SP-0503 — Warning Aggregation in Snapshot

## Tier: sonnet (no Opus design needed)

## Spec refs
- snapshot-engine-spec-corrected.md §9
- api-contract-corrected.md §7
- Errors_and_Warnings_Taxonomy_v1.0.md

## Implementation
Create `packages/snapshot/src/warnings/warning-collector.ts`:

```ts
import type { WarningDTO } from '../dto/snapshot-header.js';

export class WarningCollector {
  private warnings: WarningDTO[] = [];

  add(code: string, severity: 'INFO' | 'WARN' | 'ERROR', message?: string, entityId?: string): void {
    this.warnings.push({ code, severity, message: message ?? null, entityId });
  }

  missingSignal(entityId: string, signalKey: string): void {
    this.add('MISSING_SIGNAL', 'WARN', `Signal ${signalKey} missing for ${entityId}`, entityId);
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
}
```

## Files
- Create: `packages/snapshot/src/warnings/warning-collector.ts`
- Modify: `packages/snapshot/src/index.ts` (add export)
- Create: `packages/snapshot/test/warning-collector.test.ts`

## Tests
- Each helper method produces correct code/severity
- toArray returns copy (not mutable reference)
- Multiple warnings accumulate
