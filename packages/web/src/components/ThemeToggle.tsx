import { Sun, Moon } from 'lucide-react';

export function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  const isLight = theme === 'light';
  return (
    <button
      onClick={onToggle}
      title={isLight ? 'Cambiar a modo noche' : 'Cambiar a modo día'}
      style={{
        width: 34, height: 34, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isLight ? 'var(--sp-primary-10)' : 'var(--sp-border-8)',
        border: '1px solid var(--sp-border-8)',
        cursor: 'pointer',
        color: isLight ? 'var(--sp-primary)' : 'var(--sp-secondary)',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
    >
      {isLight ? <Moon size={14} strokeWidth={2.5} /> : <Sun size={14} strokeWidth={2.5} />}
    </button>
  );
}
