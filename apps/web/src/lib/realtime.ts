import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE, getAccessToken, refreshSession } from "./api";

const BASE = API_BASE || undefined;
let socket: Socket | null = null;
let users = 0;

/** Uma conexão Socket.IO compartilhada pelas telas (WhatsApp, Central de Mensagens). */
function acquire(): Socket {
  users++;
  if (!socket) {
    socket = io(BASE ?? "/", {
      path: "/api/socket.io",
      transports: ["websocket"],
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 10_000,
    });
    socket.on("connect_error", async (err) => {
      if (err.message === "UNAUTHORIZED" && (await refreshSession())) socket?.connect();
    });
  }
  return socket;
}

function release() {
  users--;
  if (users <= 0 && socket) {
    socket.close();
    socket = null;
    users = 0;
  }
}

/** Assina eventos em tempo real enquanto o componente estiver montado. */
export function useRealtime(handlers: Record<string, (payload: never) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const s = acquire();
    const names = Object.keys(ref.current);
    const bound = names.map((n) => [n, (p: unknown) => ref.current[n]?.(p as never)] as const);
    bound.forEach(([n, fn]) => s.on(n, fn));
    return () => {
      bound.forEach(([n, fn]) => s.off(n, fn));
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
