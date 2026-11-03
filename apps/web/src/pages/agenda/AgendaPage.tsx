import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, CalendarCheck, CalendarClock, Check, Hourglass, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/states";

interface AgendaTask {
  id: string;
  title: string;
  type: string;
  dueAt: string;
  lead: { id: string; companyName: string; phone: string | null } | null;
  assignee: { id: string; name: string } | null;
}
interface Agenda {
  overdue: AgendaTask[];
  today: AgendaTask[];
  upcoming: AgendaTask[];
  meetings: AgendaTask[];
  stale: { id: string; companyName: string; lastContactAt: string | null; updatedAt: string; stage: { name: string } }[];
}

const TYPE_LABEL: Record<string, string> = { CALL: "Ligação", FOLLOW_UP: "Follow-up", MEETING: "Reunião", PROPOSAL: "Proposta", NEGOTIATION: "Negociação", OTHER: "Tarefa" };

function TaskRow({ t, late }: { t: AgendaTask; late?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/crm/tasks/${t.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agenda"] });
      void qc.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const postpone = (days: number) => m.mutate({ dueAt: new Date(Math.max(Date.now(), new Date(t.dueAt).getTime()) + days * 86_400_000).toISOString() });
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <button type="button" onClick={() => m.mutate({ status: "DONE" })} aria-label="Concluir" className="flex size-5 shrink-0 items-center justify-center rounded-md border hover:border-success hover:bg-success/10">
        {m.isPending && m.variables?.status === "DONE" ? <Check className="size-3.5 text-success" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t.title}</p>
        <p className="text-xs text-muted">
          <Badge className="mr-1.5">{TYPE_LABEL[t.type] ?? t.type}</Badge>
          {t.lead ? <Link to={`/crm?lead=${t.lead.id}`} className="text-primary hover:underline">{t.lead.companyName}</Link> : "Sem lead"}
          {t.assignee && ` · ${t.assignee.name}`}
        </p>
      </div>
      <span className={cn("text-xs tabular-nums", late ? "font-semibold text-danger" : "text-muted")}>
        {new Date(t.dueAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => postpone(1)}>+1 dia</Button>
        <Button size="sm" variant="ghost" onClick={() => postpone(3)}>+3 dias</Button>
        <Button size="sm" variant="ghost" className="text-muted hover:text-danger" onClick={() => m.mutate({ status: "CANCELED" })} aria-label="Cancelar tarefa"><X /></Button>
      </div>
    </li>
  );
}

function Section({ icon: Icon, title, tasks, late, empty, tone }: { icon: typeof AlarmClock; title: string; tasks: AgendaTask[]; late?: boolean; empty: string; tone?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className={cn("size-4", tone)} /> {title} <span className="rounded-full bg-surface-muted px-2 text-xs text-muted">{tasks.length}</span></CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? <p className="text-sm text-muted">{empty}</p> : <ul className="divide-y">{tasks.map((t) => <TaskRow key={t.id} t={t} late={late} />)}</ul>}
      </CardContent>
    </Card>
  );
}

export function AgendaPage() {
  const [mine, setMine] = useState(() => localStorage.getItem("lh-agenda-mine") === "true");
  const q = useQuery({ queryKey: ["agenda", mine], queryFn: () => api<Agenda>(`/api/workspace/agenda?mine=${mine}`) });
  const toggle = (v: boolean) => {
    setMine(v);
    localStorage.setItem("lh-agenda-mine", String(v));
  };
  const d = q.data;
  const nothing = d && !d.overdue.length && !d.today.length && !d.upcoming.length && !d.stale.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Minha Agenda</h1>
          <p className="mt-1 text-sm text-muted">Follow-ups, reuniões e leads que precisam de atenção. Crie tarefas pelo painel de cada lead no CRM.</p>
        </div>
        <div role="radiogroup" aria-label="Escopo" className="inline-flex self-start rounded-lg border bg-surface p-1">
          {[[false, "Toda a equipe"], [true, "Só minhas"]].map(([v, l]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={mine === v} onClick={() => toggle(v as boolean)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium", mine === v ? "bg-primary text-white dark:text-slate-950" : "text-muted")}>{l as string}</button>
          ))}
        </div>
      </div>

      {q.isPending ? (
        <div className="space-y-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState message={q.error.message} onRetry={() => void q.refetch()} /></Card>
      ) : nothing ? (
        <Card><EmptyState icon={CalendarCheck} title="Agenda livre" description="Nenhuma tarefa pendente. Abra um lead no CRM e use Follow-up 3 dias ou 7 dias para programar o próximo contato." /></Card>
      ) : d ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Section icon={AlarmClock} title="Atrasadas" tasks={d.overdue} late empty="Nada atrasado." tone="text-danger" />
            <Section icon={CalendarClock} title="Hoje" tasks={d.today} empty="Nada para hoje." tone="text-primary" />
            <Section icon={CalendarCheck} title="Próximos 7 dias" tasks={d.upcoming} empty="Nada programado." />
          </div>
          <div className="space-y-6">
            <Section icon={Users} title="Reuniões" tasks={d.meetings} empty="Nenhuma reunião marcada." tone="text-success" />
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Hourglass className="size-4 text-warning" /> Leads sem movimentação <span className="rounded-full bg-surface-muted px-2 text-xs text-muted">{d.stale.length}</span></CardTitle></CardHeader>
              <CardContent>
                {d.stale.length === 0 ? <p className="text-sm text-muted">Todos os leads em andamento tiveram atividade na última semana.</p> : (
                  <ul className="divide-y">
                    {d.stale.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                        <Link to={`/crm?lead=${l.id}`} className="font-medium hover:text-primary">{l.companyName}</Link>
                        <span className="text-xs text-muted">{l.stage.name} · {l.lastContactAt ? `contato ${formatRelative(l.lastContactAt)}` : "sem contato"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
