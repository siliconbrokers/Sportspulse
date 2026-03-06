import { useState } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { competitionDisplayName } from './utils/labels.js';

const COMPETITIONS = [
  { id: 'comp:football-data:PD', code: 'PD' },
  { id: 'comp:football-data:PL', code: 'PL' },
  { id: 'comp:football-data:BL1', code: 'BL1' },
  { id: 'comp:football-data:SA', code: 'SA' },
  { id: 'comp:football-data:FL1', code: 'FL1' },
];

export function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [dateLocal, setDateLocal] = useState(() => new Date().toISOString().split('T')[0]);

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
        <input
          type="date"
          value={dateLocal}
          onChange={(e) => setDateLocal(e.target.value)}
          style={{
            backgroundColor: '#1e293b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            colorScheme: 'dark',
          }}
        />
      </div>
      <DashboardLayout
        competitionId={competitionId}
        dateLocal={dateLocal}
        timezone="America/Montevideo"
      />
    </div>
  );
}
