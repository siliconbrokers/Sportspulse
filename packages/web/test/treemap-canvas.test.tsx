import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TreemapCanvas } from '../src/components/TreemapCanvas.js';
import type { TeamScoreDTO, LayoutMetadata } from '../src/types/snapshot.js';

function makeTeam(id: string, rect: { x: number; y: number; w: number; h: number }): TeamScoreDTO {
  return {
    teamId: id,
    teamName: `Team ${id}`,
    policyKey: 'test',
    policyVersion: 1,
    buildNowUtc: '2026-03-04T11:00:00Z',
    rawScore: 50,
    attentionScore: 50,
    displayScore: 50,
    layoutWeight: 0.25,
    rect,
    topContributions: [],
  };
}

const layout: LayoutMetadata = {
  algorithmKey: 'treemap.squarified',
  algorithmVersion: 1,
  container: { width: 800, height: 600, outerPadding: 8, innerGutter: 6 },
};

describe('TreemapCanvas', () => {
  it('renders N tiles for N teams (H-01)', () => {
    const teams = [
      makeTeam('A', { x: 0, y: 0, w: 400, h: 600 }),
      makeTeam('B', { x: 400, y: 0, w: 400, h: 300 }),
      makeTeam('C', { x: 400, y: 300, w: 400, h: 300 }),
    ];

    render(<TreemapCanvas teams={teams} layout={layout} focusedTeamId={null} onSelectTeam={() => {}} />);

    expect(screen.getByTestId('tile-A')).toBeInTheDocument();
    expect(screen.getByTestId('tile-B')).toBeInTheDocument();
    expect(screen.getByTestId('tile-C')).toBeInTheDocument();
  });

  it('positions tiles at rect coordinates', () => {
    const teams = [makeTeam('X', { x: 100, y: 50, w: 200, h: 150 })];

    render(<TreemapCanvas teams={teams} layout={layout} focusedTeamId={null} onSelectTeam={() => {}} />);

    const tile = screen.getByTestId('tile-X');
    expect(tile.style.left).toBe('100px');
    expect(tile.style.top).toBe('50px');
    expect(tile.style.width).toBe('200px');
    expect(tile.style.height).toBe('150px');
  });

  it('dims non-focused tiles when a team is focused', () => {
    const teams = [
      makeTeam('A', { x: 0, y: 0, w: 400, h: 600 }),
      makeTeam('B', { x: 400, y: 0, w: 400, h: 600 }),
    ];

    render(<TreemapCanvas teams={teams} layout={layout} focusedTeamId="A" onSelectTeam={() => {}} />);

    expect(screen.getByTestId('tile-A').style.opacity).toBe('1');
    expect(screen.getByTestId('tile-B').style.opacity).toBe('0.5');
  });

  it('does not import any layout solver (H-01 boundary)', async () => {
    // Verify web package doesn't depend on @sportpulse/layout
    const pkg = await import('../package.json');
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps).not.toHaveProperty('@sportpulse/layout');
  });
});
