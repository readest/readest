export const handleGlobalError = (e: Error) => {
  const isChunkError = e?.message?.includes('Loading chunk');

  if (!isChunkError) {
    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem('lastErrorReload') || '0');
    if (now - lastReload > 60_000) {
      sessionStorage.setItem('lastErrorReload', String(now));
      window.location.reload();
    } else {
      console.warn('Error detected, but reload suppressed (rate limit)');
    }
  }
};
