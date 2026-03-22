// SPF-SUB-003 — Ad slot with Pro suppression
// Branch: reingenieria/v2 · Acceptance: K-07
//
// Invariants:
//  - Renders nothing while loading === true (fail-closed, no ad flicker)
//  - Renders nothing when isPro === true (ad suppressed for Pro users)
//  - Renders placeholder only when isPro === false AND loading === false
//
// Never import from pipeline packages.

import { useSession } from '../auth/SessionProvider.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdSlotProps {
  id: string;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdSlot({ id, className }: AdSlotProps) {
  const { isPro, loading } = useSession();

  // Fail-closed: render nothing while session is being resolved
  if (loading) return null;

  // Ad suppressed for Pro users
  if (isPro) return null;

  // Anonymous or free-tier user after session is resolved
  return (
    <div
      data-testid={`ad-slot-${id}`}
      className={
        [
          'w-full flex items-center justify-center rounded-lg text-xs',
          className ?? '',
        ]
          .join(' ')
          .trim()
      }
      style={{
        minHeight: 60,
        background: 'var(--sp-surface)',
        border: '1px dashed var(--sp-border-8)',
        color: 'var(--sp-text-40)',
      }}
      aria-label="Espacio publicitario"
    >
      Publicidad
    </div>
  );
}
