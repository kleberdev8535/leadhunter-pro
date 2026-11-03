import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, getAccessToken, refreshSession } from "@/lib/api";
import type { Agent, Task } from "./types";
import type { OfficeBridge } from "./bridge";

export type SocketState = "connecting" | "online" | "offline";
const BASE = API_BASE || undefined;

/**
 * Tempo real: aplica os eventos do Socket.IO direto no cache do TanStack Query (sem polling)
 * e repassa ao jogo o que é visual (progresso, comemoração).
 */
export function useOfficeRealtime(bridge: OfficeBridge) {
  const qc = useQueryClient();
  const [state, setState] = useState<SocketState>("connecting");

  useEffect(() => {
    const socket: Socket = io(BASE ?? "/", {
      path: "/api/socket.io",
      transports: ["websocket"],
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 10_000,
    });

    const upsertTask = (task: Task) => {
      qc.setQueryData<Task[]>(["office", "tasks"], (list) => {
        if (!list) return list;
        const i = list.findIndex((t) => t.id === task.id);
        if (i === -1) return [task, ...list];
        const copy = list.slice();
        copy[i] = { ...copy[i]!, ...task };
        return copy;
      });
      void qc.invalidateQueries({ queryKey: ["office", "task", task.id] });
    };
    const refreshStats = () => void qc.invalidateQueries({ queryKey: ["office", "stats"] });

    socket.on("connect", () => {
      setState("online");
      // Ao reconectar, ressincroniza o que pode ter mudado enquanto estava offline.
      void qc.invalidateQueries({ queryKey: ["office"] });
    });
    socket.on("disconnect", () => setState("offline"));
    socket.on("connect_error", async (err) => {
      setState("offline");
      if (err.message === "UNAUTHORIZED") {
        const token = await refreshSession();
        if (token) socket.connect();
      }
    });

    socket.on("agent:status_changed", ({ agent }: { agent: Agent }) => {
      qc.setQueryData<Agent[]>(["office", "agents"], (list) => list?.map((a) => (a.id === agent.id ? agent : a)));
      refreshStats();
    });
    for (const ev of ["task:created", "task:queued", "task:started", "task:paused", "task:completed", "task:failed", "task:cancelled"]) {
      socket.on(ev, ({ task }: { task: Task }) => {
        upsertTask(task);
        refreshStats();
        if (["task:completed", "task:failed", "task:cancelled", "task:paused"].includes(ev)) {
          // Estado final já está gravado quando o evento chega: recarrega do servidor para não deixar uma
          // resposta HTTP mais antiga (em voo) sobrescrever o estado novo no cache.
          void qc.invalidateQueries({ queryKey: ["office", "tasks"] });
          void qc.invalidateQueries({ queryKey: ["office", "agents"] });
          void qc.invalidateQueries({ queryKey: ["office", "logs"] });
        }
      });
    }
    socket.on("task:progress", ({ taskId, agentId, progress }: { taskId: string; agentId: string; progress: number }) => {
      qc.setQueryData<Task[]>(["office", "tasks"], (list) => list?.map((t) => (t.id === taskId ? { ...t, progress, status: "RUNNING" } : t)));
      bridge.emitGame("progress", agentId, progress);
    });
    socket.on("team:updated", ({ run }: { run: { id: string } }) => {
      qc.setQueryData<{ id: string }[]>(["office", "team-runs"], (list) => {
        if (!list) return list;
        const i = list.findIndex((r) => r.id === run.id);
        return i === -1 ? [run, ...list] : list.map((r) => (r.id === run.id ? run : r));
      });
    });
    socket.on("agent:task_completed", ({ agentId }: { agentId: string }) => {
      bridge.emitGame("celebrate", agentId);
      void qc.invalidateQueries({ queryKey: ["office", "agents"] });
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [qc, bridge]);

  return state;
}
