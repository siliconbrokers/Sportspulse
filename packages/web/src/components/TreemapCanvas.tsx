import { useEffect, useRef, useState } from 'react';
import type { TeamScoreDTO, LayoutMetadata } from '../types/snapshot.js';
import { TeamTile } from './TeamTile.js';

interface TreemapCanvasProps {
  teams: TeamScoreDTO[];
  layout: LayoutMetadata;
  focusedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}

export function TreemapCanvas({ teams, layout, focusedTeamId, onSelectTeam }: TreemapCanvasProps) {
  const { width, height } = layout.container;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      if (!wrapperRef.current) return;
      const parent = wrapperRef.current.parentElement;
      if (!parent) return;
      const availableWidth = parent.clientWidth - 32; // 16px padding each side
      const s = Math.min(1, availableWidth / width);
      setScale(s);
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [width]);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: width * scale,
        height: height * scale,
        margin: '0 auto',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="treemap-canvas"
        style={{
          position: 'relative',
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {teams.map((team) => (
          <TeamTile
            key={team.teamId}
            team={team}
            focused={team.teamId === focusedTeamId}
            dimmed={focusedTeamId !== null && team.teamId !== focusedTeamId}
            onClick={onSelectTeam}
          />
        ))}
      </div>
    </div>
  );
}
