import { useState, useEffect } from 'react';

export type AdBlockerState = 'checking' | 'detected' | 'not-detected';

const DISMISSED_KEY = 'sportpulse_adblocker_tip_dismissed';

/**
 * Detecta si hay un bloqueador de anuncios activo usando la técnica del elemento trampa:
 * se inserta un div con clases que uBlock/AdBlock ocultan (adsbox, ad-banner, etc.).
 * Si el elemento queda con height=0 después de un tick, fue ocultado por el bloqueador.
 */
export function useAdBlockerDetection(): {
  state: AdBlockerState;
  dismissed: boolean;
  dismiss: () => void;
} {
  const [state, setState] = useState<AdBlockerState>('checking');
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    const el = document.createElement('div');
    // Clases que uBlock Origin, AdBlock Plus y derivados ocultan por defecto
    el.className = 'adsbox ad-banner ads adsbygoogle';
    el.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(el);

    const timer = setTimeout(() => {
      const blocked = !el.offsetHeight;
      if (document.body.contains(el)) document.body.removeChild(el);
      setState(blocked ? 'detected' : 'not-detected');
    }, 250);

    return () => {
      clearTimeout(timer);
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return { state, dismissed, dismiss };
}

/** URL de instalación de uBlock Origin según el browser del usuario */
export function getUBlockInstallUrl(): { url: string; label: string } {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) {
    return {
      url: 'https://addons.mozilla.org/firefox/addon/ublock-origin/',
      label: 'Instalar en Firefox',
    };
  }
  // Chrome, Edge, Brave, Opera y otros Chromium
  return {
    url: 'https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm',
    label: 'Instalar en Chrome / Edge / Brave',
  };
}
