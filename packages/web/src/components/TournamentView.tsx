/**
 * TournamentView — vista principal de torneos con fase de grupos + eliminatorias.
 *
 * Tabs:
 *   - Grupos: tabla de posiciones por grupo + mejores terceros
 *   - Eliminatorias: bracket de rondas eliminatorias
 *
 * Usa CSS vars del sistema de diseño (light/dark mode compatible).
 * El color del tab activo usa el accent de la competición (prop).
 */
import { useState, useEffect } from 'react';
import { useGroupStandings } from '../hooks/use-group-standings.js';
import { useKnockoutBracket } from '../hooks/use-knockout-bracket.js';
import { GroupStandingsView } from './GroupStandingsView.js';
import { KnockoutBracket } from './KnockoutBracket.js';
import { PreliminaryRoundsView } from './PreliminaryRoundsView.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { computeBestThirds } from '../utils/best-thirds.js';
import type { TournamentPhase } from '../utils/competition-meta.js';

interface TournamentViewProps {
  competitionId: string;
  /** Color accent de la competición — usado en tabs activos */
  accent?: string;
  /** Fecha ISO de inicio del torneo — para banner pre-torneo */
  startDate?: string;
  onSelectTeam?: (teamId: string, dateLocal?: string) => void;
  /**
   * Fases configuradas para este torneo (desde competition-meta).
   * Determina qué tabs son visibles INDEPENDIENTEMENTE del estado de la API.
   * Si no se provee, los tabs se infieren de los datos de la API (comportamiento anterior).
   */
  phases?: TournamentPhase[];
}

type TournamentTab = TournamentPhase;

export function TournamentView({ competitionId, accent = 'var(--sp-primary)', startDate, onSelectTeam, phases }: TournamentViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  const {
    data: bracketData,
    loading: bracketLoading,
    error: bracketError,
  } = useKnockoutBracket(competitionId, true);

  // Visibilidad de tabs: si hay config estática (phases), úsala siempre.
  // Si no, infiere desde la API (comportamiento legacy).
  const hasPreliminary = phases
    ? phases.includes('previa')
    : (bracketData?.preliminaryRounds?.length ?? 0) > 0;
  const hasKnockout = phases
    ? phases.includes('eliminatorias')
    : (bracketData?.knockoutRounds?.length ?? 0) > 0;

  // Tab activo — arranca en el primer tab configurado (o 'grupos' como fallback).
  // No espera a que cargue la API para mostrar la UI.
  const defaultTab: TournamentTab = phases?.[0] ?? 'grupos';
  const [tab, setTab] = useState<TournamentTab>(defaultTab);

  // Si llegan datos de la API, selecciona el tab más activo (solo una vez al montar).
  // Prioridad: previa activa > eliminatorias activas > primer tab configurado.
  useEffect(() => {
    if (!bracketData) return;
    const apiHasPrevia = (bracketData.preliminaryRounds?.length ?? 0) > 0;
    const apiHasKnockout = (bracketData.knockoutRounds?.length ?? 0) > 0;
    if (apiHasPrevia && hasPreliminary) setTab('previa');
    else if (apiHasKnockout && hasKnockout) setTab('eliminatorias');
    // else: mantener tab actual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketData]);

  // El tab efectivo es siempre el seleccionado; el contenido maneja el estado vacío.
  const effectiveTab: TournamentTab = tab;

  const {
    data: groupData,
    loading: groupLoading,
    error: groupError,
  } = useGroupStandings(competitionId, effectiveTab === 'grupos');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: isMobile ? '8px 14px' : '8px 20px',
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    border: 'none',
    borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
    backgroundColor: 'transparent',
    color: active ? accent : 'var(--sp-text-55)',
    transition: 'color 0.15s',
    minHeight: 44,
  });

  return (
    <div>
      {/* Tab bar — solo muestra tabs con datos */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--sp-border-8)', marginBottom: 16 }}>
        {hasPreliminary && (
          <button style={tabStyle(effectiveTab === 'previa')} onClick={() => setTab('previa')}>
            Fase Previa
          </button>
        )}
        <button style={tabStyle(effectiveTab === 'grupos')} onClick={() => setTab('grupos')}>
          Grupos
        </button>
        {hasKnockout && (
          <button style={tabStyle(effectiveTab === 'eliminatorias')} onClick={() => setTab('eliminatorias')}>
            Eliminatorias
          </button>
        )}
      </div>

      {/* Contenido */}
      {effectiveTab === 'previa' ? (
        bracketLoading ? (
          <LoadingState />
        ) : bracketError ? (
          <ErrorState message={bracketError} />
        ) : (
          <PreliminaryRoundsView rounds={bracketData?.preliminaryRounds ?? []} onSelectTeam={onSelectTeam} />
        )
      ) : effectiveTab === 'grupos' ? (
        groupLoading ? (
          <LoadingState />
        ) : groupError ? (
          <ErrorState message={groupError} />
        ) : groupData && groupData.groups.length > 0 ? (
          <GroupStandingsView
            groups={groupData.groups}
            startDate={startDate}
            bestThirds={
              groupData.bestThirdsCount > 0
                ? computeBestThirds(
                    groupData.groups.flatMap((g) => g.standings),
                    groupData.bestThirdsCount,
                  )
                : undefined
            }
          />
        ) : hasPreliminary ? (
          <PreliminaryPendingState />
        ) : (
          <EmptyState label="datos de grupos" />
        )
      ) : (
        bracketLoading ? (
          <LoadingState />
        ) : bracketError ? (
          <ErrorState message={bracketError} />
        ) : (
          <KnockoutBracket rounds={bracketData?.knockoutRounds ?? []} />
        )
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div style={{ color: 'var(--sp-text-40)', fontSize: 13, padding: '24px 0' }}>
      Cargando...
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ color: '#ef4444', fontSize: 13, padding: '24px 0' }}>
      Error: {message}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ color: 'var(--sp-text-40)', fontSize: 13, padding: '24px 0' }}>
      Sin {label} disponibles.
    </div>
  );
}

function PreliminaryPendingState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8, padding: '32px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 28 }}>⏳</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-70)' }}>
        Los grupos se definirán al finalizar la Fase Previa
      </div>
      <div style={{ fontSize: 12, color: 'var(--sp-text-40)', maxWidth: 320 }}>
        Los equipos clasificados completarán los grupos existentes.
        Revisá el tab <strong>Fase Previa</strong> para ver el estado de los cruces.
      </div>
    </div>
  );
}
