import { useEffect, useRef } from 'react';

// Subscribes to the backend WebSocket and calls onEvent({event, data}) for each
// message. Auto-reconnects on drop.
export function useWebSocket(onEvent) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws;
    let closed = false;
    let retry;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.onmessage = (e) => {
        try { handlerRef.current(JSON.parse(e.data)); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      if (ws) ws.close();
    };
  }, []);
}
