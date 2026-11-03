/** Status vindos do backend (enum AgentStatus). */
export type AgentStatus =
  | "IDLE"
  | "AVAILABLE"
  | "ASSIGNED"
  | "WORKING"
  | "WAITING"
  | "PAUSED"
  | "COMPLETED"
  | "ERROR"
  | "OFFLINE";

export type Place = "station" | "lounge" | "none";
export type Pose = "type" | "sit" | "stand";
export type Badge = "none" | "waiting" | "paused" | "error" | "assigned";

export interface Behavior {
  place: Place;
  /** Pose ao chegar no destino. */
  pose: Pose;
  badge: Badge;
  /** Pode dar pequenas voltas pela sala de descanso. */
  wander: boolean;
  showProgress: boolean;
}

/**
 * Tradução direta e única de status → comportamento visual. Só WORKING digita no computador,
 * então o escritório nunca mostra trabalho que não existe no backend.
 */
export function behaviorFor(status: AgentStatus): Behavior {
  switch (status) {
    case "WORKING":
      return { place: "station", pose: "type", badge: "none", wander: false, showProgress: true };
    case "ASSIGNED":
      return { place: "station", pose: "sit", badge: "assigned", wander: false, showProgress: false };
    case "WAITING":
      return { place: "station", pose: "sit", badge: "waiting", wander: false, showProgress: false };
    case "PAUSED":
      return { place: "station", pose: "sit", badge: "paused", wander: false, showProgress: false };
    case "ERROR":
      return { place: "station", pose: "stand", badge: "error", wander: false, showProgress: false };
    case "OFFLINE":
      return { place: "none", pose: "stand", badge: "none", wander: false, showProgress: false };
    case "COMPLETED":
    case "AVAILABLE":
    case "IDLE":
    default:
      // Livres ficam na própria mesa (monitor desligado) e de vez em quando levantam para passear.
      // Só WORKING digita: o passeio nunca é apresentado como trabalho.
      return { place: "station", pose: "sit", badge: "none", wander: true, showProgress: false };
  }
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  IDLE: "Ocioso",
  AVAILABLE: "Disponível",
  ASSIGNED: "Tarefa atribuída",
  WORKING: "Trabalhando",
  WAITING: "Aguardando nova tentativa",
  PAUSED: "Pausado",
  COMPLETED: "Concluiu tarefa",
  ERROR: "Erro",
  OFFLINE: "Offline",
};
