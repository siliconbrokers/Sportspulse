import { useState, useCallback, useEffect } from 'react';

interface UrlState {
  mode: 'form' | 'agenda';
  focus: string | null;
}

function readFromUrl(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'agenda' ? 'agenda' : 'form';
  const focus = params.get('focus') || null;
  return { mode, focus };
}

function writeToUrl(state: UrlState) {
  const params = new URLSearchParams();
  if (state.mode !== 'form') params.set('mode', state.mode);
  if (state.focus) params.set('focus', state.focus);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export function useUrlState() {
  const [state, setState] = useState<UrlState>(readFromUrl);

  useEffect(() => {
    writeToUrl(state);
  }, [state]);

  const setMode = useCallback((mode: 'form' | 'agenda') => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const setFocus = useCallback((teamId: string | null) => {
    setState((prev) => ({ ...prev, focus: teamId }));
  }, []);

  return { ...state, setMode, setFocus };
}
