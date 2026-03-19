/**
 * LiguillaSectionView — Vista de la fase Liguilla (playoffs) de Liga MX.
 *
 * Muestra todas las rondas de la Liguilla apiladas verticalmente:
 *   Play-In (matchday 18) → Cuartos (19) → Semis (20) → Final (21)
 *
 * Solo muestra rondas que tienen partidos. Funciona tanto para la vista
 * "partidos" (MatchCardList) como "pronosticos" (PronosticoCard grid).
 */

import { useWindowWidth } from '../hooks/use-window-width.js';
import { useDashboardSnapshot } from '../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { useUrlState } from '../hooks/use-url-state.js';
import { MatchCardList } from './MatchCardList.js';
import { DetailPanel } from './DetailPanel.js';
import { PronosticoCard } from './pronosticos/PronosticoCard.js';
import { useRadar } from '../hooks/use-radar.js';

// ── Rondas de la Liguilla ─────────────────────────────────────────────────────

const LIGUILLA_ROUNDS = [
  { matchday: 18, label: 'Play-In' },
  { matchday: 19, label: 'Cuartos de Final' },
  { matchday: 20, label: 'Semifinales' },
  { matchday: 21, label: 'Final' },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface LiguillaSectionViewProps {
  competitionId: string;
  subTournamentKey: string;
  viewMode: 'partidos' | 'pronosticos';
}

// ── Round section wrapper ─────────────────────────────────────────────────────

function RoundSection({
  label,
  children,
  isMobile,
}: {
  label: string;
  children: React.ReactNode;
  isMobile: boolean;
}) {
  return (
    <div style={{ marginBottom: isMobile ? 24 : 32 }}>
      <div
        style={{
          fontSize: isMobile ? 13 : 14,
          fontWeight: 700,
          color: 'var(--sp-text-55)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: isMobile ? 8 : 10,
          paddingLeft: 2,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Hooks para las 4 rondas (siempre en el mismo orden — regla de hooks) ──────

function useLiguillaRounds(competitionId: string, subTournamentKey: string, timezone: string) {
  const r18 = useDashboardSnapshot(competitionId, 18, timezone, undefined, subTournamentKey);
  const r19 = useDashboardSnapshot(competitionId, 19, timezone, undefined, subTournamentKey);
  const r20 = useDashboardSnapshot(competitionId, 20, timezone, undefined, subTournamentKey);
  const r21 = useDashboardSnapshot(competitionId, 21, timezone, undefined, subTournamentKey);
  return [
    { ...r18, matchday: 18, label: 'Play-In' },
    { ...r19, matchday: 19, label: 'Cuartos de Final' },
    { ...r20, matchday: 20, label: 'Semifinales' },
    { ...r21, matchday: 21, label: 'Final' },
  ] as const;
}

// ── LiguillaSectionView ───────────────────────────────────────────────────────

export function LiguillaSectionView({
  competitionId,
  subTournamentKey,
  viewMode,
}: LiguillaSectionViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const { focus, setFocus } = useUrlState();

  const rounds = useLiguillaRounds(competitionId, subTournamentKey, 'America/Montevideo');
  const { data: radarData } = useRadar(competitionId, null);

  // Team detail for the focused match (used by DetailPanel)
  const { data: teamDetail } = useTeamDetail(competitionId, focus, null, 'America/Montevideo');

  // Filter to rounds that have data
  const activeRounds = rounds.filter(
    (r) => !r.loading && (r.data?.matchCards?.length ?? 0) > 0,
  );

  const isAllLoading = rounds.every((r) => r.loading);

  if (isAllLoading) {
    return (
      <div
        style={{
          padding: isMobile ? '16px 0' : '24px 0',
          color: 'var(--sp-text-30)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        Cargando Liguilla...
      </div>
    );
  }

  if (activeRounds.length === 0) {
    return (
      <div
        style={{
          padding: isMobile ? '32px 16px' : '48px 24px',
          background: 'var(--sp-surface-card)',
          border: '1px solid var(--sp-border-8)',
          borderRadius: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏆</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 6 }}>
          La Liguilla aún no comenzó
        </div>
        <div style={{ fontSize: 12, color: 'var(--sp-text-30)' }}>
          Los partidos aparecerán aquí cuando se publique el fixture.
        </div>
      </div>
    );
  }

  return (
    <div>
      {activeRounds.map((round) => (
        <RoundSection key={round.matchday} label={round.label} isMobile={isMobile}>
          {viewMode === 'partidos' ? (
            <MatchCardList
              matchCards={round.data?.matchCards ?? []}
              onSelectTeam={(id) => setFocus(id === focus ? null : id)}
              focusedTeamId={focus}
              showForm={false}
              loading={round.loading}
              competitionId={competitionId}
              matchday={round.matchday}
              serverComputedAtUtc={round.data?.header?.computedAtUtc}
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? '1fr'
                  : 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: isMobile ? 8 : 12,
              }}
            >
              {(round.data?.matchCards ?? []).map((card, i) => {
                const radarCard = radarData?.cards?.find(
                  (rc) => rc.matchId === card.matchId,
                ) ?? null;
                const live = radarData?.liveData?.find(
                  (ld) => ld.homeTeamId === card.homeTeamId || ld.awayTeamId === card.awayTeamId,
                ) ?? null;
                return (
                  <PronosticoCard
                    key={card.matchId}
                    matchCard={card}
                    radarCard={radarCard}
                    live={live}
                    onViewMatch={(id) => setFocus(id === focus ? null : id)}
                    animationDelay={i * 40}
                    competitionId={competitionId}
                  />
                );
              })}
            </div>
          )}
        </RoundSection>
      ))}

      {focus && teamDetail && (
        <DetailPanel
          detail={teamDetail}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}
