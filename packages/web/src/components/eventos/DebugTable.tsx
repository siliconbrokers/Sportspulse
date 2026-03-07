// spec §14 — bloque de debug de parseo, visible solo en modo test
import type { ParsedEvent } from '../../hooks/use-events.js';

interface DebugTableProps {
  events: ParsedEvent[];
}

const CELL: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 11,
  color: 'rgba(255,255,255,0.65)',
  whiteSpace: 'nowrap',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const HEADER: React.CSSProperties = {
  ...CELL,
  color: 'rgba(255,255,255,0.4)',
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  borderBottom: '1px solid rgba(255,255,255,0.12)',
};

function leagueBadgeColor(league: string): string {
  if (league === 'EXCLUIDA') return '#ef4444';
  if (league === 'URUGUAY_PRIMERA') return '#3b82f6';
  if (league === 'LALIGA') return '#f59e0b';
  if (league === 'PREMIER_LEAGUE') return '#a855f7';
  if (league === 'BUNDESLIGA') return '#ef4444';
  return '#64748b';
}

export function DebugTable({ events }: DebugTableProps) {
  return (
    <div style={{
      marginTop: 24,
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', letterSpacing: 0.5 }}>
          DEBUG — Parseo de eventos
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
          {events.length} eventos totales
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              {/* spec §14.3 */}
              {['raw_event', 'parsed_time', 'parsed_competition', 'normalized_league',
                'parsed_home', 'parsed_away', 'parsed_status',
                'display_time_portal_tz', 'source_url'].map((col) => (
                <th key={col} style={HEADER}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} style={{
                background: ev.normalizedLeague === 'EXCLUIDA'
                  ? 'rgba(239,68,68,0.05)'
                  : ev.normalizedLeague === 'OTRA'
                  ? 'rgba(100,116,139,0.05)'
                  : 'transparent',
              }}>
                <td style={{ ...CELL, maxWidth: 160 }} title={ev.rawText}>{ev.rawText}</td>
                <td style={CELL}>{ev.sourceTimeText ?? '—'}</td>
                <td style={{ ...CELL, maxWidth: 140 }}>{ev.sourceCompetitionText ?? '—'}</td>
                <td style={CELL}>
                  <span style={{
                    color: leagueBadgeColor(ev.normalizedLeague),
                    fontWeight: 700,
                    fontSize: 10,
                  }}>
                    {ev.normalizedLeague}
                  </span>
                </td>
                <td style={CELL}>{ev.homeTeam ?? '—'}</td>
                <td style={CELL}>{ev.awayTeam ?? '—'}</td>
                <td style={CELL}>{ev.normalizedStatus}</td>
                {/* spec §12.6 — debug horario */}
                <td style={CELL}>{ev.startsAtPortalTz ?? '—'}</td>
                <td style={{ ...CELL, maxWidth: 120 }} title={ev.sourceUrl ?? ''}>
                  {ev.openUrl
                    ? <a href={ev.openUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: '#60a5fa', textDecoration: 'none', fontSize: 10 }}>
                        link
                      </a>
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
