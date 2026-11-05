'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@magura/shared';
import { API_URL, socketAuth } from './api';
import { useSession } from './session';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SocketCtx = createContext<AppSocket | null>(null);
/** Wall-clock of the last server message, shared without re-rendering on every event. */
const lastMsg = { at: 0 };

export function SocketProvider({ children }: { children: ReactNode }) {
  const { me, ready } = useSession();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const userId = me?.id ?? null;

  useEffect(() => {
    if (!ready) return;
    let s: AppSocket | null = null;
    let cancelled = false;
    socketAuth().then((auth) => {
      if (cancelled) return;
      s = io(API_URL, { path: '/ws', transports: ['websocket'], auth });
      s.on('connect', () => (lastMsg.at = Date.now()));
      s.onAny(() => (lastMsg.at = Date.now()));
      s.io.on('ping', () => (lastMsg.at = Date.now()));
      setSocket(s);
    });
    return () => {
      cancelled = true;
      s?.disconnect();
      setSocket(null);
    };
  }, [ready, userId]);

  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}

export function useSocket() {
  return useContext(SocketCtx);
}

/** Subscribe to a server event for the lifetime of the component. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  const socket = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = ((...args: unknown[]) => (ref.current as (...a: unknown[]) => void)(...args)) as ServerToClientEvents[E];
    socket.on(event, fn as any);
    return () => {
      socket.off(event, fn as any);
    };
  }, [socket, event]);
}

/** Connection health for the header pill and status bar: re-evaluated every second. */
export function useLiveStatus(): { state: 'live' | 'stale' | 'offline'; age: number } {
  const socket = useSocket();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!socket?.connected) return { state: 'offline', age: 0 };
  const age = lastMsg.at ? Math.max(0, Math.round((Date.now() - lastMsg.at) / 1000)) : 0;
  return { state: age > 30 ? 'stale' : 'live', age };
}
