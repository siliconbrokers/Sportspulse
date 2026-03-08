import { useState, useEffect } from 'react';

export type AdBlockerState = 'checking' | 'detected' | 'not-detected';

const DISMISSED_KEY = 'sportpulse_adblocker_tip_dismissed';

/**
 * Detecta si hay un bloqueador de anuncios activo usando la técnica del elemento trampa:
 * se inserta un div con clases que uBlock/AdBlock/Brave ocultan (adsbox, ad-banner, etc.).
 * Si el elemento queda con height=0 después de un tick, fue ocultado por el bloqueador.
 * Funciona en desktop y en Firefox Android con uBlock.
 */
export function useAdBlockerDetection(): {
  state: AdBlockerState;
  dismissed: boolean;
  dismiss: () => void;
  recommendation: BlockerRecommendation;
} {
  const [state, setState] = useState<AdBlockerState>('checking');
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    const el = document.createElement('div');
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

  return { state, dismissed, dismiss, recommendation: getRecommendation() };
}

export interface BlockerRecommendation {
  platform: 'desktop' | 'android-firefox' | 'android-other' | 'ios';
  title: string;
  body: string;
  cta: string;
  url: string;
  note?: string;
}

/** Devuelve la recomendación correcta según plataforma y browser del usuario */
export function getRecommendation(): BlockerRecommendation {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isFirefox = /Firefox/.test(ua);

  if (isIOS) {
    return {
      platform: 'ios',
      title: 'Usá Brave para ver partidos sin interrupciones',
      body: 'En iPhone y iPad no hay extensiones de bloqueo, pero Brave tiene bloqueador de popups integrado. Abrí el partido directamente desde Brave.',
      cta: 'Descargar Brave para iPhone/iPad',
      url: 'https://apps.apple.com/app/brave-private-web-browser/id1052879175',
    };
  }

  if (isAndroid && !isFirefox) {
    return {
      platform: 'android-other',
      title: 'Usá Firefox con uBlock Origin para ver partidos sin popups',
      body: 'Firefox para Android es el único browser mobile que soporta extensiones. Con uBlock Origin instalado, los popups del streaming se bloquean automáticamente.',
      cta: 'Descargar Firefox para Android',
      url: 'https://play.google.com/store/apps/details?id=org.mozilla.firefox',
      note: 'Después instalá uBlock Origin desde el menú de extensiones de Firefox',
    };
  }

  if (isAndroid && isFirefox) {
    // Firefox Android sin uBlock detectado
    return {
      platform: 'android-firefox',
      title: 'Instalá uBlock Origin en Firefox',
      body: 'Ya estás en Firefox, que soporta extensiones. Instalá uBlock Origin para bloquear automáticamente los popups del streaming.',
      cta: 'Instalar uBlock Origin',
      url: 'https://addons.mozilla.org/firefox/addon/ublock-origin/',
    };
  }

  // Desktop
  if (isFirefox) {
    return {
      platform: 'desktop',
      title: 'Instalá uBlock Origin para ver partidos sin interrupciones',
      body: 'Al abrir un partido pueden aparecer ventanas emergentes del proveedor de streaming. uBlock Origin las bloquea automáticamente.',
      cta: 'Instalar en Firefox',
      url: 'https://addons.mozilla.org/firefox/addon/ublock-origin/',
      note: 'Gratuito y de código abierto',
    };
  }

  return {
    platform: 'desktop',
    title: 'Instalá uBlock Origin para ver partidos sin interrupciones',
    body: 'Al abrir un partido pueden aparecer ventanas emergentes del proveedor de streaming. uBlock Origin las bloquea automáticamente.',
    cta: 'Instalar en Chrome / Edge / Brave',
    url: 'https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm',
    note: 'Gratuito y de código abierto',
  };
}

/** @deprecated usar getRecommendation() */
export function getUBlockInstallUrl(): { url: string; label: string } {
  const r = getRecommendation();
  return { url: r.url, label: r.cta };
}
