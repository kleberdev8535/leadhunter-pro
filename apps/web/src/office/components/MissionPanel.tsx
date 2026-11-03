import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, Loader2, Pause, Rocket, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { EmptyState } from "@/components/states";
import { AGENT_COLOR, type AgentKind } from "../types";

export interface TeamRunStep {
  index: number;
  key: "hunter" | "scout" | "atlas" | "writer" | "metrics";
  title: string;
  taskId: string | null;
  status: string;
  progress: number;
  error: string | null;
}
export interface TeamRun {
  id: string;
  title: string;
  status: "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | "QUEUED" | "PENDING";
  currentStep: number;
  totalSteps: number;
  error: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  steps: TeamRunStep[];
}

const KIND: Record<TeamRunStep["key"], AgentKind> = { hunter: "HUNTER", scout: "SCOUT", atlas: "ATLAS", writer: "WRITER", metrics: "METRICS" };
const NAME: Record<TeamRunStep["key"], string> = { hunter: "Hunter", scout: "Scout", atlas: "Atlas", writer: "Writer", metrics: "Metrics" };
const RUN_LABEL: Record<string, { label: string; tone: "primary" | "success" | "danger" | "warning" | "neutral" }> = {
  RUNNING: { label: "Em andamento", tone: "primary" },
  PAUSED: { label: "Pausada", tone: "warning" },
  COMPLETED: { label: "Concluída", tone: "success" },
  FAILED: { label: "Falhou", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

export const useTeamRuns = () =>
  useQuery({ queryKey: ["office", "team-runs"], queryFn: () => api<TeamRun[]>("/api/office/team-runs"), refetchInterval: 30_000 });

/** Resumo legível do que cada agente entregou. */
function stepResult(run: TeamRun, key: TeamRunStep["key"]): string | null {
  const r = run.summary[key] as Record<string, number> | undefined;
  if (!r) return null;
  switch (key) {
    case "hunter": return `${r.saved ?? 0} encontradas`;
    case "scout": return `${r.high ?? 0} alto · ${r.medium ?? 0} médio`;
    case "atlas": return `${r.created ?? 0} no CRM${r.duplicates ? ` · ${r.duplicates} já existiam` : ""}`;
    case "writer": return `${(r.drafts as unknown as unknown[] | undefined)?.length ?? 0} rascunhos`;
    case "metrics": return "relatório pronto";
  }
}

function Stepper({ run }: { run: TeamRun }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {run.steps.map((s, i) => {
        const done = s.status === "COMPLETED";
        const active = s.status === "RUNNING" || s.status === "QUEUED";
        const failed = s.status === "FAILED" || s.status === "CANCELLED";
        const paused = s.status === "PAUSED";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", active && "border-primary/50 bg-primary-soft", done && "border-success/40", failed && "border-danger/40 bg-danger/5")}>
              <span className="flex size-7 items-center justify-center rounded-lg font-mono text-xs font-bold text-white" style={{ background: AGENT_COLOR[KIND[s.key]] }}>
                {done ? <Check className="size-4" /> : failed ? <X className="size-4" /> : paused ? <Pause className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : NAME[s.key][0]}
              </span>
              <div className="leading-tight">
                <p className="text-xs font-semibold">{NAME[s.key]}</p>
                <p className="text-[11px] text-muted">{active ? `${s.title}… ${s.progress}%` : stepResult(run, s.key) ?? s.title}</p>
              </div>
            </div>
            {i < run.steps.length - 1 && <span className={cn("text-muted", done && "text-success")}>→</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Missão em andamento (ou a última), em destaque acima do escritório. */
export function ActiveMission({ onNew }: { onNew: () => void }) {
  const qc = useQueryClient();
  const runs = useTeamRuns();
  const run = runs.data?.find((r) => r.status === "RUNNING" || r.status === "PAUSED") ?? runs.data?.[0];
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/office/team-runs/${id}/cancel`, { method: "POST" }),
    onSuccess: () => { toast.success("Missão cancelada"); void qc.invalidateQueries({ queryKey: ["office"] }); },
    onError: (e) => toast.error(e.message),
  });
  if (!run) {
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Rocket className="size-5 text-primary" />
        <p className="flex-1 text-sm text-muted">Nenhuma missão ainda. Uma missão faz a equipe trabalhar em sequência: Hunter → Scout → Atlas → Writer → Metrics.</p>
        <Button size="sm" onClick={onNew}><Rocket /> Nova missão</Button>
      </Card>
    );
  }
  const meta = RUN_LABEL[run.status] ?? RUN_LABEL.RUNNING!;
  const live = run.status === "RUNNING" || run.status === "PAUSED";
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Rocket className="size-4 text-primary" />
        <p className="text-sm font-semibold">{live ? "Missão em andamento" : "Última missão"}: {run.title}</p>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="text-xs text-muted">{formatRelative(run.createdAt)}</span>
        <div className="ml-auto flex gap-2">
          {live && <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" loading={cancel.isPending} onClick={() => cancel.mutate(run.id)}><Ban /> Cancelar</Button>}
          {!live && <Button size="sm" onClick={onNew}><Rocket /> Nova missão</Button>}
        </div>
      </div>
      <Stepper run={run} />
      {run.error && <p className="text-xs text-danger">{run.error}</p>}
      {typeof run.summary.note === "string" && <p className="text-xs text-muted">{run.summary.note}</p>}
    </Card>
  );
}

export function MissionsView() {
  const runs = useTeamRuns();
  if (!runs.data?.length) return <EmptyState icon={Rocket} title="Nenhuma missão" description="Inicie pela Central de Comando, no modo Missão da equipe." className="py-8" />;
  return (
    <ul className="-mr-2 h-full space-y-3 overflow-y-auto pr-2">
      {runs.data.map((r) => {
        const meta = RUN_LABEL[r.status] ?? RUN_LABEL.RUNNING!;
        return (
          <li key={r.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{r.title}</p>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            <p className="text-[11px] text-muted">{formatRelative(r.createdAt)}</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {r.steps.map((s) => (
                <span key={s.key} className={cn("rounded-full px-2 py-0.5", s.status === "COMPLETED" ? "bg-success/10 text-success" : s.status === "FAILED" ? "bg-danger/10 text-danger" : "bg-surface-muted text-muted")}>
                  {NAME[s.key]}{stepResult(r, s.key) ? `: ${stepResult(r, s.key)}` : ""}
                </span>
              ))}
            </div>
            {r.error && <p className="text-[11px] text-danger">{r.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
