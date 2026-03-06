import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { StandingsTable } from './components/StandingsTable.js';
import { useStandings } from './hooks/use-standings.js';
import { useCompetitionInfo } from './hooks/use-competition-info.js';
import { competitionDisplayName } from './utils/labels.js';

type ViewMode = 'treemap' | 'standings';

const COMPETITIONS = [
  { id: 'comp:football-data:PD', code: 'PD' },
  { id: 'comp:football-data:PL', code: 'PL' },
  { id: 'comp:football-data:BL1', code: 'BL1' },
  { id: 'comp:football-data:SA', code: 'SA' },
  { id: 'comp:football-data:FL1', code: 'FL1' },
];

export function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('treemap');
  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(competitionId);
  const { data: standings, loading: standingsLoading } = useStandings(competitionId, view === 'standings');

  // Set matchday to current when competition info loads
  useEffect(() => {
    if (compInfo?.currentMatchday) {
      setMatchday(compInfo.currentMatchday);
    }
  }, [compInfo]);

  // Reset matchday when competition changes
  useEffect(() => {
    setMatchday(null);
  }, [competitionId]);

  const totalMatchdays = compInfo?.totalMatchdays ?? 38;
  const matchdayOptions = Array.from({ length: totalMatchdays }, (_, i) => i + 1);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '8px 16px',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <img
          src="/logo.png"
          alt="SportsPulse"
          style={{ height: 40, width: 'auto' }}
        />
        <select
          value={competitionId}
          onChange={(e) => setCompetitionId(e.target.value)}
          style={{
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {COMPETITIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {competitionDisplayName(c.id)}
            </option>
          ))}
        </select>
        <select
          value={matchday ?? ''}
          onChange={(e) => setMatchday(Number(e.target.value))}
          disabled={compInfoLoading || !compInfo}
          style={{
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            cursor: 'pointer',
            opacity: compInfoLoading ? 0.5 : 1,
          }}
        >
          {compInfoLoading ? (
            <option value="">Cargando...</option>
          ) : (
            matchdayOptions.map((md) => (
              <option key={md} value={md}>
                Jornada {md}{md === compInfo?.currentMatchday ? ' (actual)' : ''}
              </option>
            ))
          )}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['treemap', 'standings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                backgroundColor: view === v ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: view === v ? 700 : 400,
              }}
            >
              {v === 'treemap' ? 'Mapa' : 'Tabla'}
            </button>
          ))}
        </div>
      </div>
      {view === 'treemap' ? (
        <DashboardLayout
          competitionId={competitionId}
          matchday={matchday}
          timezone="America/Montevideo"
        />
      ) : (
        <div style={{ padding: 16 }}>
          {standingsLoading && <div style={{ color: '#fff', opacity: 0.5 }}>Cargando tabla...</div>}
          {standings && <StandingsTable standings={standings} onTeamClick={() => {}} />}
        </div>
      )}
    </div>
  );
}
