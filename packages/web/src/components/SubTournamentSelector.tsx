/**
 * SubTournamentSelector — selector de sub-torneo (Clausura / Apertura / etc.)
 *
 * Solo se renderiza cuando la liga tiene más de un sub-torneo disponible.
 * Aparece debajo del LeagueSelector como una fila de tabs compactos.
 */
import type { SubTournamentInfo } from '../hooks/use-competition-info.js';

interface SubTournamentSelectorProps {
  subTournaments: SubTournamentInfo[];
  selected: string | null;
  onChange: (key: string) => void;
}

export function SubTournamentSelector({
  subTournaments,
  selected,
  onChange,
}: SubTournamentSelectorProps) {
  if (subTournaments.length <= 1) return null;

  return (
    <div className="flex items-center gap-1" style={{ padding: '0 4px' }}>
      {subTournaments.map((st) => {
        const isSelected = selected === st.key;
        return (
          <button
            key={st.key}
            onClick={() => onChange(st.key)}
            className="flex items-center gap-1 rounded-full text-xs font-semibold transition-all"
            style={{
              padding: '4px 12px',
              minHeight: 28,
              background: isSelected ? 'var(--sp-primary-10)' : 'var(--sp-border)',
              border: `1px solid ${isSelected ? 'var(--sp-primary-40)' : 'var(--sp-border-8)'}`,
              color: isSelected ? 'var(--sp-primary)' : 'var(--sp-text-55)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {st.label}
            {st.isActive && !isSelected && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--sp-primary)', opacity: 0.7 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
