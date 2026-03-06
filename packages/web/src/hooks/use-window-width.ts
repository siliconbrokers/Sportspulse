import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function useWindowWidth(): { width: number; breakpoint: Breakpoint } {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const breakpoint: Breakpoint = width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop';
  return { width, breakpoint };
}
