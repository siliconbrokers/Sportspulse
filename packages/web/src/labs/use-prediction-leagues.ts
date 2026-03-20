import { useState, useEffect } from 'react';

export interface PredictionLeague {
  id: string;
  displayName: string;
  slug: string;
}

/**
 * Returns active non-tournament competitions from portal-config.
 * Used by all lab pages to populate league selectors dynamically.
 */
export function usePredictionLeagues(): PredictionLeague[] {
  const [leagues, setLeagues] = useState<PredictionLeague[]>([]);

  useEffect(() => {
    fetch('/api/ui/portal-config')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          cfg: {
            competitions?: {
              id: string;
              displayName: string;
              slug: string;
              mode: string;
              isTournament?: boolean;
            }[];
          } | null,
        ) => {
          if (!cfg?.competitions) return;
          setLeagues(
            cfg.competitions
              .filter((c) => c.mode !== 'disabled' && !c.isTournament)
              .map((c) => ({ id: c.id, displayName: c.displayName, slug: c.slug })),
          );
        },
      )
      .catch(() => {
        /* silently ignore */
      });
  }, []);

  return leagues;
}
