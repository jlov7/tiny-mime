import { useEffect, useState } from 'react';

// Browser Internet hints do not establish whether the loopback service is reachable.
const recheckEvent = 'tm:recheck-local-connection';
export function useLocalConnection(): { offline: boolean; recheck: () => void } {
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let controller: AbortController | null = null; let sequence = 0;
    const check = async () => {
      const current = ++sequence; controller?.abort(); controller = new AbortController();
      const currentController = controller; const signal = currentController.signal; const timer = setTimeout(() => currentController.abort(), 3000);
      try { const response = await fetch('/', { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal }); if (current === sequence) setUnreachable(!response.ok); }
      catch { if (current === sequence) setUnreachable(true); }
      finally { clearTimeout(timer); }
    };
    const hint = () => { void check(); };
    hint(); window.addEventListener('online', hint); window.addEventListener('offline', hint); window.addEventListener('focus', hint); window.addEventListener(recheckEvent, hint);
    return () => { ++sequence; controller?.abort(); window.removeEventListener('online', hint); window.removeEventListener('offline', hint); window.removeEventListener('focus', hint); window.removeEventListener(recheckEvent, hint); };
  }, []);
  // Recheck every mounted owner, including Study and its player. This sends no actions.
  return { offline: unreachable, recheck: () => { window.dispatchEvent(new Event(recheckEvent)); } };
}
