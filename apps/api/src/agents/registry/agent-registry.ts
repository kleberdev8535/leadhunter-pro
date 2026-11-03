import type { AgentKind, AgentTaskType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

export interface AgentDefinition {
  kind: AgentKind;
  name: string;
  role: string;
  /** Estação de trabalho no mapa do escritório (id compartilhado com o frontend). */
  station: string;
  supports: readonly AgentTaskType[];
  /** Ferramentas autorizadas: o worker só tem acesso a estas integrações. */
  tools: readonly string[];
}

/** AgentRegistry: fonte única da verdade sobre quem existe e o que cada um pode fazer. */
export const AGENT_REGISTRY: Readonly<Record<AgentKind, AgentDefinition>> = {
  HUNTER: {
    kind: "HUNTER",
    name: "Hunter",
    role: "Prospectador — busca empresas no Google Maps",
    station: "prospect-1",
    supports: ["SEARCH_LEADS", "UPDATE_LEADS"],
    tools: ["google-places"],
  },
  SCOUT: {
    kind: "SCOUT",
    name: "Scout",
    role: "Qualificador — aplica critérios e calcula o score",
    station: "analysis-1",
    supports: ["QUALIFY_LEADS"],
    tools: ["leads:read", "leads:score"],
  },
  ATLAS: {
    kind: "ATLAS",
    name: "Atlas",
    role: "Gestor de CRM — importa e organiza leads no Kanban",
    station: "crm-1",
    supports: ["IMPORT_TO_CRM"],
    tools: ["crm:write"],
  },
  WRITER: {
    kind: "WRITER",
    name: "Writer",
    role: "Copywriter operacional — prepara mensagens por template (sem IA)",
    station: "comms-1",
    supports: ["GENERATE_MESSAGES"],
    tools: ["templates", "leads:read"],
  },
  METRICS: {
    kind: "METRICS",
    name: "Metrics",
    role: "Analista de dados — gera relatórios e indicadores",
    station: "manager-1",
    supports: ["GENERATE_REPORT"],
    tools: ["reports"],
  },
};

export const AGENT_KINDS = Object.keys(AGENT_REGISTRY) as AgentKind[];

export function agentForTask(type: AgentTaskType): AgentKind {
  const def = Object.values(AGENT_REGISTRY).find((d) => d.supports.includes(type));
  if (!def) throw new Error(`Nenhum agente executa ${type}`);
  return def.kind;
}

/** Garante os 5 agentes da organização (idempotente: pode rodar em todo acesso). */
export async function ensureAgents(organizationId: string) {
  await prisma.agent.createMany({
    data: AGENT_KINDS.map((kind) => ({ organizationId, kind, name: AGENT_REGISTRY[kind].name })),
    skipDuplicates: true,
  });
}
