import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'sportspulse_theme';

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'light';
  });

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
