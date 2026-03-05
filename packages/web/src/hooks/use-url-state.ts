import { useCallback, useSyncExternalStore } from 'react';

interface UrlState {
  mode: 'form' | 'agenda';
  focus: string | null;
}

function getSnapshot(): string {
  return window.location.search;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function parseSearch(search: string): UrlState {
  const params = new URLSearchParams(search);
  const mode = params.get('mode') === 'agenda' ? 'agenda' : 'form';
  const focus = params.get('focus') || null;
  return { mode, focus };
}

function setParam(key: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value === null) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useUrlState() {
  const search = useSyncExternalStore(subscribe, getSnapshot);
  const state = parseSearch(search);

  const setMode = useCallback((mode: 'form' | 'agenda') => {
    setParam('mode', mode === 'form' ? null : mode);
  }, []);

  const setFocus = useCallback((teamId: string | null) => {
    setParam('focus', teamId);
  }, []);

  return { ...state, setMode, setFocus };
}
