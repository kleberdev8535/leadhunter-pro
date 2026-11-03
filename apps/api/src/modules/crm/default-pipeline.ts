import type { StageKind } from "../../generated/prisma/client.js";

/** Etapas padrão do funil. A `key` é estável e usada pelos relatórios; o nome pode ser renomeado. */
export const DEFAULT_STAGES: ReadonlyArray<{ key: string; name: string; color: string; kind: StageKind }> = [
  { key: "new", name: "Leads novos", color: "#64748B", kind: "OPEN" },
  { key: "qualified", name: "Lead qualificado", color: "#6366F1", kind: "OPEN" },
  { key: "first_contact", name: "Primeiro contato", color: "#0EA5E9", kind: "OPEN" },
  { key: "awaiting_reply", name: "Aguardando resposta", color: "#F59E0B", kind: "OPEN" },
  { key: "negotiation", name: "Em negociação", color: "#8B5CF6", kind: "OPEN" },
  { key: "meeting", name: "Reunião agendada", color: "#14B8A6", kind: "OPEN" },
  { key: "proposal", name: "Proposta enviada", color: "#EC4899", kind: "OPEN" },
  { key: "won", name: "Cliente convertido", color: "#22C55E", kind: "WON" },
  { key: "lost", name: "Perdido", color: "#EF4444", kind: "LOST" },
];
