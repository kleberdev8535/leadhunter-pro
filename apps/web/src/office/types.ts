import type { AgentStatus } from "./agents/behavior";

export type AgentKind = "HUNTER" | "SCOUT" | "ATLAS" | "WRITER" | "METRICS";
export type TaskType = "SEARCH_LEADS" | "QUALIFY_LEADS" | "IMPORT_TO_CRM" | "GENERATE_MESSAGES" | "GENERATE_REPORT" | "UPDATE_LEADS";
export type TaskStatus = "PENDING" | "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  role: string;
  station: string;
  supports: TaskType[];
  status: AgentStatus;
  paused: boolean;
  currentTaskId: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  avgRunMs: number;
  successRate: number | null;
  lastActiveAt: string | null;
}

export interface Task {
  id: string;
  agentId: string;
  agentName?: string;
  agentKind?: AgentKind;
  taskType: TaskType;
  title: string;
  description: string | null;
  parameters: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  progress: number;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  runAfter: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  controlRequest: string | null;
}

export interface TaskLog {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface OrgLog extends TaskLog {
  taskId: string;
  taskTitle: string;
  agentName: string;
  agentKind: AgentKind;
}

export interface OfficeStats {
  agentsOnline: number;
  agentsWorking: number;
  agentsAvailable: number;
  tasksRunning: number;
  tasksQueued: number;
  tasksPaused: number;
  tasksFailed: number;
  completedToday: number;
  successRateToday: number | null;
  avgRunMs: number;
}

export interface Catalog {
  niches: { key: string; label: string }[];
  agents: { kind: AgentKind; name: string; role: string; supports: TaskType[]; station: string }[];
  limits: { maxResultsPerQuery: number };
}

export const TASK_LABEL: Record<TaskType, string> = {
  SEARCH_LEADS: "Buscar leads no Google Maps",
  QUALIFY_LEADS: "Qualificar leads",
  IMPORT_TO_CRM: "Importar leads para o CRM",
  GENERATE_MESSAGES: "Gerar mensagens comerciais",
  GENERATE_REPORT: "Gerar relatório de prospecção",
  UPDATE_LEADS: "Atualizar dados de leads",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "Pendente",
  QUEUED: "Na fila",
  RUNNING: "Executando",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const AGENT_COLOR: Record<AgentKind, string> = {
  HUNTER: "#2f6fdc",
  SCOUT: "#2e9e5b",
  ATLAS: "#e07b2a",
  WRITER: "#7c4dd6",
  METRICS: "#6b7280",
};

export const formatDuration = (ms: number) => {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
};
