import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

// SPF-FND-002 — Competition registry global context.
// Acceptance: pre-condition for K-series (no active matrix ID maps directly to this foundation)
// Additive: does not replace existing prop-drilling in App.tsx.
// Components may optionally consume this starting WP-09+.

export interface CompetitionEntry {
  id: string;
  code: string;
  isTournament: boolean;
  enabled: boolean;
}

export interface CompetitionContextValue {
  competitions: CompetitionEntry[];
  enabledIds: string[];
}

const CompetitionContext = createContext<CompetitionContextValue>({
  competitions: [],
  enabledIds: [],
});

export function CompetitionProvider({
  children,
  competitions,
}: {
  children: ReactNode;
  competitions: CompetitionEntry[];
}): ReactNode {
  const enabledIds = competitions.filter((c) => c.enabled).map((c) => c.id);
  return (
    <CompetitionContext.Provider value={{ competitions, enabledIds }}>
      {children}
    </CompetitionContext.Provider>
  );
}

export function useCompetitions(): CompetitionContextValue {
  return useContext(CompetitionContext);
}
