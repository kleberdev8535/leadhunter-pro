import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, ClipboardList, FileBarChart, History, Pause, Play, RotateCcw, ScrollText, Search, Send } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatDateTime, formatNumber, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/states";
import { STATUS_LABEL } from "../agents/behavior";
import {
  AGENT_COLOR,
  TASK_LABEL,
  TASK_STATUS_LABEL,
  formatDuration,
  type Agent,
  type OrgLog,
  type Task,
  type TaskLog,
  type TaskStatus,
} from "../types";

const STATUS_TONE: Record<TaskStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  QUEUED: "neutral",
  RUNNING: "primary",
  PAUSED: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const AGENT_STATUS_DOT: Record<string, string> = {
  WORKING: "bg-primary",
  ASSIGNED: "bg-sky-400",
  WAITING: "bg-amber-400",
  PAUSED: "bg-amber-500",
  ERROR: "bg-danger",
  COMPLETED: "bg-success",
  AVAILABLE: "bg-success",
  IDLE: "bg-slate-400",
  OFFLINE: "bg-slate-500",
};

export function AgentAvatar({ agent, size = 32 }: { agent: Pick<Agent, "kind" | "name">; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-white shadow-sm"
      style={{ width: size, height: size, background: AGENT_COLOR[agent.kind] }}
      aria-hidden
    >
      {agent.name[0]}
    </span>
  );
}

function useTaskActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" | "retry" }) =>
      api<Task>(`/api/office/tasks/${id}/${action}`, { method: "POST", body: action === "retry" ? { idempotencyKey: crypto.randomUUID() } : {} }),
    onSuccess: (_t, { action }) => {
      const msg = { pause: "Pausa solicitada", resume: "Tarefa retomada", cancel: "Cancelamento solicitado", retry: "Tarefa reenviada" }[action];
      toast.success(msg);
      void qc.invalidateQueries({ queryKey: ["office"] });
    },
    onError: (err) => toast.error(err.message),
  });
}

export function TaskActions({ task, compact }: { task: Task; compact?: boolean }) {
  const m = useTaskActions();
  const size = compact ? "sm" : "md";
  const pending = task.controlRequest;
  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {(task.status === "QUEUED" || task.status === "RUNNING") && (
        <Button variant="secondary" size={size} disabled={!!pending} loading={m.isPending && m.variables?.action === "pause"} onClick={() => m.mutate({ id: task.id, action: "pause" })}>
          <Pause /> {pending === "pause" ? "Pausando…" : "Pausar"}
        </Button>
      )}
      {task.status === "PAUSED" && (
        <Button variant="secondary" size={size} onClick={() => m.mutate({ id: task.id, action: "resume" })}>
          <Play /> Retomar
        </Button>
      )}
      {["QUEUED", "RUNNING", "PAUSED", "PENDING"].includes(task.status) && (
        <Button variant="ghost" size={size} disabled={pending === "cancel"} className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => m.mutate({ id: task.id, action: "cancel" })}>
          <Ban /> {pending === "cancel" ? "Cancelando…" : "Cancelar"}
        </Button>
      )}
      {["FAILED", "CANCELLED", "COMPLETED"].includes(task.status) && (
        <Button variant="secondary" size={size} onClick={() => m.mutate({ id: task.id, action: "retry" })}>
          <RotateCcw /> Reexecutar
        </Button>
      )}
    </div>
  );
}

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const active = task.status === "RUNNING";
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn("w-full rounded-xl border bg-surface p-3 text-left transition-all hover:border-primary/40 hover:shadow-sm", active && "border-primary/40 ring-1 ring-primary/20")}
    >
      <div className="flex items-start gap-2.5">
        {task.agentKind && <AgentAvatar agent={{ kind: task.agentKind, name: task.agentName ?? "?" }} size={26} />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{task.title}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {task.agentName} · {formatRelative(task.createdAt)}
            {task.retryCount > 0 && ` · tentativa ${task.retryCount + 1}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
      </div>
      {(active || task.status === "PAUSED") && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${task.progress}%` }} />
        </div>
      )}
      {task.status === "FAILED" && task.errorMessage && <p className="mt-2 line-clamp-2 text-xs text-danger">{task.errorMessage}</p>}
    </button>
  );
}

const FILTERS: { key: TaskStatus | "ALL" | "ACTIVE"; label: string }[] = [
  { key: "ACTIVE", label: "Ativas" },
  { key: "QUEUED", label: "Na fila" },
  { key: "COMPLETED", label: "Concluídas" },
  { key: "FAILED", label: "Falhas" },
  { key: "ALL", label: "Todas" },
];

export function TasksView({ tasks, loading, onOpen, agentFilter, onClearAgent }: {
  tasks: Task[] | undefined;
  loading: boolean;
  onOpen: (id: string) => void;
  agentFilter?: Agent | null;
  onClearAgent?: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>(() => (sessionStorage.getItem("lh-office-filter") as never) ?? "ACTIVE");
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    let l = tasks ?? [];
    if (agentFilter) l = l.filter((t) => t.agentId === agentFilter.id);
    if (filter === "ACTIVE") l = l.filter((t) => ["RUNNING", "QUEUED", "PAUSED", "PENDING"].includes(t.status));
    else if (filter !== "ALL") l = l.filter((t) => t.status === filter);
    if (q.trim()) l = l.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase()));
    return l;
  }, [tasks, filter, q, agentFilter]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar tarefa…" className="pl-9" aria-label="Pesquisar tarefa" />
      </div>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => { setFilter(f.key); sessionStorage.setItem("lh-office-filter", f.key); }}
            className={cn("rounded-full px-2.5 py-1 text-xs font-medium", filter === f.key ? "bg-primary text-white dark:text-slate-950" : "bg-surface-muted text-muted hover:text-foreground")}>
            {f.label}
          </button>
        ))}
        {agentFilter && (
          <button type="button" onClick={onClearAgent} className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
            {agentFilter.name} ×
          </button>
        )}
      </div>
      <div className="-mr-2 flex-1 space-y-2 overflow-y-auto pr-2">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
        ) : list.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nenhuma tarefa aqui" description="Envie uma tarefa pela Central de Comando e acompanhe o agente trabalhando." className="py-8" />
        ) : (
          list.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

export function HistoryView({ tasks, onOpen }: { tasks: Task[] | undefined; onOpen: (id: string) => void }) {
  const done = (tasks ?? []).filter((t) => ["COMPLETED", "FAILED", "CANCELLED"].includes(t.status));
  if (done.length === 0) return <EmptyState icon={History} title="Sem histórico ainda" description="Tarefas finalizadas aparecem aqui em ordem cronológica." className="py-8" />;
  return (
    <ol className="relative -mr-2 h-full space-y-3 overflow-y-auto border-l pl-4 pr-2">
      {done.map((t) => (
        <li key={t.id} className="relative">
          <span className={cn("absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-surface", t.status === "COMPLETED" ? "bg-success" : t.status === "FAILED" ? "bg-danger" : "bg-slate-400")} />
          <button type="button" onClick={() => onOpen(t.id)} className="text-left">
            <p className="text-sm font-medium hover:text-primary">{t.title}</p>
            <p className="text-[11px] text-muted">
              {t.agentName} · {TASK_STATUS_LABEL[t.status]} · {t.completedAt ? formatDateTime(t.completedAt) : "—"}
              {t.startedAt && t.completedAt && ` · ${formatDuration(new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime())}`}
            </p>
          </button>
        </li>
      ))}
    </ol>
  );
}

const LEVEL_CLS = { info: "text-sky-400", warn: "text-amber-400", error: "text-red-400" } as const;

export function LogsView({ agentFilter }: { agentFilter?: Agent | null }) {
  const logs = useQuery({
    queryKey: ["office", "logs", agentFilter?.id ?? "all"],
    queryFn: () => api<OrgLog[]>(`/api/office/logs?limit=100${agentFilter ? `&agentId=${agentFilter.id}` : ""}`),
    refetchInterval: 15_000,
  });
  if (logs.isPending) return <Skeleton className="h-64 rounded-xl" />;
  if (logs.isError) return <ErrorState message={logs.error.message} onRetry={() => void logs.refetch()} />;
  if (logs.data.length === 0) return <EmptyState icon={ScrollText} title="Sem logs" description="Cada passo executado pelos agentes é registrado aqui." className="py-8" />;
  return (
    <div className="h-full overflow-y-auto rounded-xl bg-[#0b1120] p-3 font-mono text-[11px] leading-relaxed text-slate-300">
      {logs.data.map((l) => (
        <p key={l.id} className="break-words">
          <span className="text-slate-500">{new Date(l.createdAt).toLocaleTimeString("pt-BR")}</span>{" "}
          <span style={{ color: AGENT_COLOR[l.agentKind] }} className="font-semibold">[{l.agentName}]</span>{" "}
          <span className={LEVEL_CLS[l.level]}>{l.level.toUpperCase()}</span> {l.message}
        </p>
      ))}
    </div>
  );
}

interface Report {
  generatedAt: string;
  periodDays: number;
  cards: Record<string, number>;
  funnel: { stage: string; total: number }[];
  scoreDistribution: { tier: string; total: number }[];
  agentTasks: { taskType: string; status: string; total: number }[];
}

export function ReportsView({ tasks, onGenerate }: { tasks: Task[] | undefined; onGenerate: () => void }) {
  const reports = (tasks ?? []).filter((t) => t.taskType === "GENERATE_REPORT" && t.status === "COMPLETED" && t.result);
  const [selected, setSelected] = useState(0);
  const r = reports[selected]?.result as unknown as Report | undefined;
  if (!r) {
    return (
      <EmptyState icon={FileBarChart} title="Nenhum relatório ainda" description="O Metrics consolida os indicadores reais do banco num relatório salvo."
        action={<Button size="sm" onClick={onGenerate}><Send /> Pedir relatório ao Metrics</Button>} className="py-8" />
    );
  }
  const cards: [string, number | string][] = [
    ["Leads", r.cards.totalLeads ?? 0],
    ["Qualificados", r.cards.qualified ?? 0],
    ["Contatados", r.cards.contacted ?? 0],
    ["Convertidos", r.cards.converted ?? 0],
    ["Conversão", `${r.cards.conversionRate ?? 0}%`],
    ["Sem site", r.cards.withoutWebsite ?? 0],
  ];
  return (
    <div className="-mr-2 h-full space-y-4 overflow-y-auto pr-2">
      <div className="flex items-center gap-2">
        <select className="h-9 flex-1 rounded-lg border bg-surface px-2 text-xs" value={selected} onChange={(e) => setSelected(Number(e.target.value))} aria-label="Relatório">
          {reports.map((t, i) => <option key={t.id} value={i}>{formatDateTime(t.completedAt!)} · {(t.result as unknown as Report).periodDays} dias</option>)}
        </select>
        <Button size="sm" variant="secondary" onClick={onGenerate}>Novo</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cards.map(([l, v]) => (
          <div key={l} className="rounded-lg border p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted">{l}</p>
            <p className="text-lg font-semibold tabular-nums">{typeof v === "number" ? formatNumber(v) : v}</p>
          </div>
        ))}
      </div>
      <table className="w-full text-xs">
        <caption className="mb-1 text-left text-xs font-semibold">Funil</caption>
        <tbody>
          {r.funnel.map((f) => (
            <tr key={f.stage} className="border-t"><td className="py-1.5">{f.stage}</td><td className="py-1.5 text-right tabular-nums">{f.total}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="w-full text-xs">
        <caption className="mb-1 text-left text-xs font-semibold">Potencial (score)</caption>
        <tbody>
          {r.scoreDistribution.map((s) => (
            <tr key={s.tier} className="border-t"><td className="py-1.5 capitalize">{s.tier}</td><td className="py-1.5 text-right tabular-nums">{s.total}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["office", "task", taskId],
    queryFn: () => api<Task & { logs: TaskLog[] }>(`/api/office/tasks/${taskId}`),
    enabled: !!taskId,
  });
  const t = q.data;
  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()} title={t?.title ?? "Tarefa"} className="max-w-2xl"
      description={t ? `${TASK_LABEL[t.taskType]} · ${t.agentName} · criada ${formatDateTime(t.createdAt)}` : undefined}>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={q.error.message} />
      ) : t ? (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
            <span className="text-xs text-muted">Progresso {t.progress}% · tentativas {t.retryCount + 1}/{t.maxRetries + 1}</span>
          </div>
          <TaskActions task={t} compact />
          {t.description && <p className="rounded-lg bg-surface-muted p-3 text-sm">{t.description}</p>}
          {t.errorMessage && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{t.errorMessage}</p>}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Timeline de execução</h4>
            <ol className="space-y-1.5 border-l pl-3">
              {t.logs.map((l) => (
                <li key={l.id} className="text-xs">
                  <span className="tabular-nums text-muted">{new Date(l.createdAt).toLocaleTimeString("pt-BR")}</span>{" "}
                  <span className={cn(l.level === "error" && "text-danger", l.level === "warn" && "text-warning")}>{l.message}</span>
                </li>
              ))}
            </ol>
          </section>
          {t.result && <ResultView task={t} />}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Parâmetros</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-muted p-3">{JSON.stringify(t.parameters, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </Dialog>
  );
}

function ResultView({ task }: { task: Task }) {
  const r = task.result as Record<string, unknown>;
  if (task.taskType === "GENERATE_MESSAGES") {
    const drafts = (r.drafts as { leadId: string; companyName: string; body: string }[]) ?? [];
    return (
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Rascunhos ({drafts.length}) — nada foi enviado</h4>
        <ul className="space-y-2">
          {drafts.map((d) => (
            <li key={d.leadId} className="rounded-lg border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{d.companyName}</span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => { void navigator.clipboard.writeText(d.body); toast.success("Copiado"); }}>Copiar</button>
              </div>
              <p className="text-muted">{d.body}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const entries = Object.entries(r).filter(([, v]) => typeof v !== "object");
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Resultado</h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-muted p-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted">{RESULT_LABEL[k] ?? k}</dt>
            <dd className="font-medium">{typeof v === "boolean" ? (v ? "sim" : "não") : String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const RESULT_LABEL: Record<string, string> = {
  saved: "Lugares salvos", scanned: "Analisados", skippedByFilter: "Fora dos filtros", requests: "Requisições ao Google",
  estimatedCostUsd: "Custo estimado (USD)", requested: "Solicitados", complete: "Meta atingida", note: "Observação",
  created: "Leads criados", duplicates: "Já existiam", skipped: "Ignorados", movedToQualified: "Movidos p/ qualificado", total: "Total",
  evaluated: "Avaliados", high: "Alto potencial", medium: "Médio", low: "Baixo", updated: "Atualizados", checked: "Verificados",
  closedPermanently: "Fechados", searchJobId: "ID da busca", suppressed: "Bloqueados (opt-out)", sent: "Enviados", generatedAt: "Gerado em", periodDays: "Período (dias)",
};

export function AgentPanel({ agent, task, onAssign, onShowTasks, onShowLogs, onDetails }: {
  agent: Agent;
  task: Task | undefined;
  onAssign: () => void;
  onShowTasks: () => void;
  onShowLogs: () => void;
  onDetails: () => void;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api<Agent>(`/api/office/agents/${agent.id}`, { method: "PATCH", body: { paused: !agent.paused } }),
    onSuccess: (a) => {
      toast.success(a.paused ? `${a.name} pausado` : `${a.name} retomado`);
      void qc.invalidateQueries({ queryKey: ["office"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AgentAvatar agent={agent} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{agent.name}</p>
          <p className="text-xs text-muted">{agent.role}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className={cn("size-2.5 rounded-full", AGENT_STATUS_DOT[agent.status])} />
        {STATUS_LABEL[agent.status]}
        {agent.paused && <Badge tone="warning">Pausado</Badge>}
      </div>
      {task ? (
        <div className="rounded-xl border p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Tarefa atual</p>
          <p className="mt-1 text-sm font-medium">{task.title}</p>
          <div className="mt-2 h-1.5 rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${task.progress}%` }} /></div>
          <p className="mt-1 text-right text-[11px] tabular-nums text-muted">{task.progress}%</p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted">Sem tarefa em execução</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {[
          ["Concluídas", agent.tasksCompleted],
          ["Falhas", agent.tasksFailed],
          ["Tempo médio", formatDuration(agent.avgRunMs)],
          ["Estação", agent.station],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg bg-surface-muted p-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted">{l}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" onClick={onAssign}><Send /> Atribuir tarefa</Button>
        <Button size="sm" variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {agent.paused ? <><Play /> Retomar agente</> : <><Pause /> Pausar agente</>}
        </Button>
        <Button size="sm" variant="secondary" onClick={onShowTasks}><History /> Ver histórico</Button>
        <Button size="sm" variant="secondary" onClick={onShowLogs}><ScrollText /> Ver logs</Button>
      </div>
      <button type="button" onClick={onDetails} className="w-full text-center text-xs text-primary hover:underline">Detalhes completos</button>
    </div>
  );
}

export function AgentDetailsDialog({ agent, tasks, onClose, onOpenTask }: { agent: Agent | null; tasks: Task[]; onClose: () => void; onOpenTask: (id: string) => void }) {
  const mine = tasks.filter((t) => t.agentId === agent?.id).slice(0, 12);
  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()} title={agent ? `${agent.name} — ficha completa` : ""} description={agent?.role} className="max-w-xl">
      {agent && (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {[
              ["Status", STATUS_LABEL[agent.status]],
              ["Taxa de sucesso", agent.successRate === null ? "—" : `${agent.successRate}%`],
              ["Tempo médio", formatDuration(agent.avgRunMs)],
              ["Concluídas", agent.tasksCompleted],
              ["Falhas", agent.tasksFailed],
              ["Última atividade", agent.lastActiveAt ? formatRelative(agent.lastActiveAt) : "—"],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-lg bg-surface-muted p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted">{l}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Tarefas que executa</p>
            <div className="flex flex-wrap gap-1.5">{agent.supports.map((s) => <Badge key={s} tone="primary">{TASK_LABEL[s]}</Badge>)}</div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Últimas tarefas</p>
            {mine.length === 0 ? <p className="text-sm text-muted">Nenhuma ainda.</p> : (
              <ul className="space-y-1.5">
                {mine.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted">
                      <span className="truncate">{t.title}</span>
                      <Badge tone={STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
