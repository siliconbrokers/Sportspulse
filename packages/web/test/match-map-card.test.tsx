import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MatchMapCard, resolveScoreDisplay, resolveInterestDisplay } from '../src/components/MatchMapCard.js';

// ─── Helper factories ─────────────────────────────────────────────────────────

const home = { id: 'atm', name: 'Atlético Madrid', shortName: 'Atlético', crestUrl: '/crests/atm.png' };
const away = { id: 'sev', name: 'Sevilla FC', shortName: 'Sevilla', crestUrl: '/crests/sev.png' };
const baseProps = { matchId: 'match_001', homeTeam: home, awayTeam: away };

// ─── resolveScoreDisplay (§ 6.3) ──────────────────────────────────────────────

describe('resolveScoreDisplay', () => {
  it('uses display field when present', () => {
    expect(resolveScoreDisplay({ home: 1, away: 0, display: '1 - 0 (pen)' })).toBe('1 - 0 (pen)');
  });

  it('ignores whitespace-only display', () => {
    expect(resolveScoreDisplay({ home: 2, away: 1, display: '   ' })).toBe('2 - 1');
  });

  it('builds from home/away when no display', () => {
    expect(resolveScoreDisplay({ home: 3, away: 0 })).toBe('3 - 0');
  });

  it('returns vs when no score', () => {
    expect(resolveScoreDisplay(null)).toBe('vs');
    expect(resolveScoreDisplay(undefined)).toBe('vs');
    expect(resolveScoreDisplay({ home: null, away: null })).toBe('vs');
  });
});

// ─── resolveInterestDisplay (§ 6.6) ──────────────────────────────────────────

describe('resolveInterestDisplay', () => {
  it('returns —% for null', () => expect(resolveInterestDisplay(null)).toBe('—%'));
  it('returns —% for undefined', () => expect(resolveInterestDisplay(undefined)).toBe('—%'));
  it('returns —% for NaN', () => expect(resolveInterestDisplay(NaN)).toBe('—%'));
  it('rounds decimal', () => expect(resolveInterestDisplay(78.7)).toBe('79%'));
  it('clamps below 0', () => expect(resolveInterestDisplay(-5)).toBe('0%'));
  it('clamps above 100', () => expect(resolveInterestDisplay(150)).toBe('100%'));
  it('handles exact 0', () => expect(resolveInterestDisplay(0)).toBe('0%'));
  it('handles exact 100', () => expect(resolveInterestDisplay(100)).toBe('100%'));
});

// ─── MatchMapCard — render completo (CA-01 … CA-09) ──────────────────────────

describe('MatchMapCard — render completo', () => {
  it('CA-01: muestra ambos nombres en el header', () => {
    render(
      <MatchMapCard
        {...baseProps}
        score={{ home: 2, away: 1 }}
        kickoff={{ utc: '2026-03-08T20:00:00Z', relativeLabel: 'Hoy en 5 horas' }}
        interestPercent={78}
      />,
    );
    expect(screen.getByTestId('match-map-card-home-name')).toHaveTextContent('Atlético');
    expect(screen.getByTestId('match-map-card-away-name')).toHaveTextContent('Sevilla');
  });

  it('CA-02: nombre local en el slot izquierdo del header', () => {
    render(<MatchMapCard {...baseProps} />);
    const header = screen.getByTestId('match-map-card-header');
    const [left, right] = Array.from(header.children);
    expect(left).toHaveAttribute('data-testid', 'match-map-card-home-name');
    expect(right).toHaveAttribute('data-testid', 'match-map-card-away-name');
  });

  it('CA-03: nombre visitante en el slot derecho del header', () => {
    render(<MatchMapCard {...baseProps} />);
    const header = screen.getByTestId('match-map-card-header');
    const [, right] = Array.from(header.children);
    expect(right).toHaveAttribute('data-testid', 'match-map-card-away-name');
  });

  it('CA-04: ambos escudos en match-map-card-crests', () => {
    render(<MatchMapCard {...baseProps} />);
    expect(screen.getByTestId('match-map-card-away-crest')).toBeInTheDocument();
    expect(screen.getByTestId('match-map-card-home-crest')).toBeInTheDocument();
  });

  it('CA-05: escudo visitante a la izquierda del local en crests', () => {
    render(<MatchMapCard {...baseProps} />);
    const crests = screen.getByTestId('match-map-card-crests');
    const [left, right] = Array.from(crests.children);
    expect(left).toHaveAttribute('data-testid', 'match-map-card-away-crest');
    expect(right).toHaveAttribute('data-testid', 'match-map-card-home-crest');
  });

  it('CA-06: score aparece en match-map-card-score', () => {
    render(<MatchMapCard {...baseProps} score={{ home: 2, away: 1 }} />);
    expect(screen.getByTestId('match-map-card-score')).toHaveTextContent('2 - 1');
  });

  it('CA-07: status aparece en match-map-card-status', () => {
    render(<MatchMapCard {...baseProps} formLabel="VIENE_PICANTE" />);
    expect(screen.getByTestId('match-map-card-status')).toHaveTextContent('Viene picante');
  });

  it('CA-08: timeline en slot izquierdo del footer', () => {
    render(
      <MatchMapCard
        {...baseProps}
        kickoff={{ utc: '2026-03-08T20:00:00Z', relativeLabel: 'Hoy en 5 horas' }}
      />,
    );
    const footer = screen.getByTestId('match-map-card-footer');
    const [left] = Array.from(footer.children);
    expect(left).toHaveAttribute('data-testid', 'match-map-card-kickoff');
    expect(left).toHaveTextContent('Hoy en 5 horas');
  });

  it('CA-09: porcentaje en slot derecho del footer', () => {
    render(<MatchMapCard {...baseProps} interestPercent={78} />);
    const footer = screen.getByTestId('match-map-card-footer');
    const [, right] = Array.from(footer.children);
    expect(right).toHaveAttribute('data-testid', 'match-map-card-interest');
    expect(right).toHaveTextContent('78%');
  });

  it('usa article como elemento raíz con data-match-id', () => {
    const { container } = render(<MatchMapCard {...baseProps} />);
    const article = container.querySelector('article');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('data-match-id', 'match_001');
  });

  it('no contiene texto "equipo más buscado" ni similar (CA-11)', () => {
    const { container } = render(<MatchMapCard {...baseProps} interestPercent={90} />);
    expect(container.textContent).not.toMatch(/m[aá]s buscado/i);
  });
});

// ─── Fallbacks (§ 15) ─────────────────────────────────────────────────────────

describe('Fallbacks', () => {
  it('§15.4 score faltante → vs', () => {
    render(<MatchMapCard {...baseProps} score={null} />);
    expect(screen.getByTestId('match-map-card-score')).toHaveTextContent('vs');
  });

  it('§15.5 formLabel faltante → Normal', () => {
    render(<MatchMapCard {...baseProps} formLabel={null} />);
    expect(screen.getByTestId('match-map-card-status')).toHaveTextContent('Normal');
  });

  it('§15.6 kickoff.relativeLabel faltante → Próximamente', () => {
    render(<MatchMapCard {...baseProps} kickoff={{ utc: '2026-03-08T20:00:00Z' }} />);
    expect(screen.getByTestId('match-map-card-kickoff')).toHaveTextContent('Próximamente');
  });

  it('§15.6 kickoff null → Próximamente', () => {
    render(<MatchMapCard {...baseProps} kickoff={null} />);
    expect(screen.getByTestId('match-map-card-kickoff')).toHaveTextContent('Próximamente');
  });

  it('§15.7 interestPercent faltante → —%', () => {
    render(<MatchMapCard {...baseProps} interestPercent={null} />);
    expect(screen.getByTestId('match-map-card-interest')).toHaveTextContent('—%');
  });

  it('§15.1 nombre local faltante → —', () => {
    render(
      <MatchMapCard
        {...baseProps}
        homeTeam={{ id: 'x', name: '' }}
        awayTeam={{ id: 'y', name: '' }}
      />,
    );
    expect(screen.getByTestId('match-map-card-home-name')).toHaveTextContent('—');
  });

  it('§15.8 interestPercent decimal → redondeado', () => {
    render(<MatchMapCard {...baseProps} interestPercent={78.7} />);
    expect(screen.getByTestId('match-map-card-interest')).toHaveTextContent('79%');
  });

  it('§15.8 interestPercent fuera de rango → clampeado', () => {
    render(<MatchMapCard {...baseProps} interestPercent={150} />);
    expect(screen.getByTestId('match-map-card-interest')).toHaveTextContent('100%');
  });

  it('caso D: formLabel inválido → Normal', () => {
    render(<MatchMapCard {...baseProps} formLabel={'INVALIDO' as never} />);
    expect(screen.getByTestId('match-map-card-status')).toHaveTextContent('Normal');
  });

  it('prefiere shortName sobre name (§ 6.1)', () => {
    render(
      <MatchMapCard
        {...baseProps}
        homeTeam={{ id: 'atm', name: 'Atlético Madrid', shortName: 'Atlético' }}
      />,
    );
    expect(screen.getByTestId('match-map-card-home-name')).toHaveTextContent('Atlético');
    expect(screen.getByTestId('match-map-card-home-name')).not.toHaveTextContent('Atlético Madrid');
  });

  it('score desde display field (§ 6.3)', () => {
    render(
      <MatchMapCard {...baseProps} score={{ home: 1, away: 0, display: '1 - 0 (AET)' }} />,
    );
    expect(screen.getByTestId('match-map-card-score')).toHaveTextContent('1 - 0 (AET)');
  });
});

// ─── Estados visuales (§ 14) ─────────────────────────────────────────────────

describe('Estados visuales', () => {
  it('estado loading — skeleton presente, no contenido real (§ 14.6)', () => {
    render(<MatchMapCard {...baseProps} isLoading={true} />);
    // Estructura skeleton está presente
    expect(screen.getByTestId('match-map-card-header')).toBeInTheDocument();
    expect(screen.getByTestId('match-map-card-crests')).toBeInTheDocument();
    expect(screen.getByTestId('match-map-card-score')).toBeInTheDocument();
    expect(screen.getByTestId('match-map-card-status')).toBeInTheDocument();
    expect(screen.getByTestId('match-map-card-footer')).toBeInTheDocument();
    // No muestra texto de equipos reales
    expect(screen.queryByText('Atlético')).not.toBeInTheDocument();
  });

  it('estado selected — data-selected=true (§ 14.4)', () => {
    render(<MatchMapCard {...baseProps} isSelected={true} />);
    expect(screen.getByTestId('match-map-card')).toHaveAttribute('data-selected', 'true');
  });

  it('estado disabled — data-disabled=true, sin onClick (§ 14.5)', () => {
    const onClick = vi.fn();
    render(<MatchMapCard {...baseProps} disabled={true} onClick={onClick} />);
    const card = screen.getByTestId('match-map-card');
    expect(card).toHaveAttribute('data-disabled', 'true');
    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('caso E: card no clickable — sin role button (§ 14, caso E)', () => {
    render(<MatchMapCard {...baseProps} />);
    expect(screen.getByTestId('match-map-card')).not.toHaveAttribute('role');
  });

  it('card clickable — tiene role=button y tabIndex (§ 16.2)', () => {
    render(<MatchMapCard {...baseProps} onClick={() => {}} />);
    const card = screen.getByTestId('match-map-card');
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('onClick se llama al hacer click (§ 4.2)', () => {
    const onClick = vi.fn();
    render(<MatchMapCard {...baseProps} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('match-map-card'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Enter activa onClick (§ 16.2)', () => {
    const onClick = vi.fn();
    render(<MatchMapCard {...baseProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByTestId('match-map-card'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Space activa onClick (§ 16.2)', () => {
    const onClick = vi.fn();
    render(<MatchMapCard {...baseProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByTestId('match-map-card'), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('testId personalizado aplicado (§ 4.2)', () => {
    render(<MatchMapCard {...baseProps} testId="my-card" />);
    expect(screen.getByTestId('my-card')).toBeInTheDocument();
  });

  it('aria-label consolidado presente (§ 16.3)', () => {
    render(
      <MatchMapCard
        {...baseProps}
        score={{ home: 2, away: 1 }}
        formLabel="VIENE_PICANTE"
        kickoff={{ utc: '2026-03-08T20:00:00Z', relativeLabel: 'Hoy en 5 horas' }}
        interestPercent={78}
      />,
    );
    const card = screen.getByTestId('match-map-card');
    const label = card.getAttribute('aria-label') ?? '';
    expect(label).toContain('Atlético');
    expect(label).toContain('Sevilla');
    expect(label).toContain('2 - 1');
    expect(label).toContain('Viene picante');
    expect(label).toContain('Hoy en 5 horas');
    expect(label).toContain('78%');
  });
});
