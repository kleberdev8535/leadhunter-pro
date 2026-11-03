import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Bot, CheckCircle2, Clock, Gauge, ListTodo, Maximize2, Settings, Terminal, Users, Wifi, WifiOff, X, ZoomIn, ZoomOut, Expand } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/states";
import { OfficeBridge, type OfficeAgent } from "./bridge";
import { useOfficeRealtime } from "./useOfficeRealtime";
import { STATUS_LABEL } from "./agents/behavior";
import { CommandCenter } from "./components/CommandCenter";
import { ActiveMission, MissionsView } from "./components/MissionPanel";
import { AGENT_STATUS_DOT, AgentAvatar, AgentDetailsDialog, AgentPanel, HistoryView, LogsView, ReportsView, TaskDialog, TasksView } from "./components/panels";
import { formatDuration, type Agent, type OfficeStats, type Task } from "./types";

// O tempo real (Socket.IO) é a fonte principal; esta sincronização lenta só cobre eventos perdidos.
const SAFETY_SYNC_MS = 30_000;

type Tab = "missions" | "agents" | "tasks" | "history" | "logs" | "reports";
const TABS: { id: Tab; label: string }[] = [
  { id: "missions", label: "Missões" },
  { id: "agents", label: "Agentes" },
  { id: "tasks", label: "Tarefas" },
  { id: "history", label: "Histórico" },
  { id: "logs", label: "Logs" },
  { id: "reports", label: "Relatórios" },
];

function GameCanvas({ bridge }: { bridge: OfficeBridge }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let game: { destroy: (b: boolean) => void } | null = null;
    let cancelled = false;
    const off = bridge.onUi("ready", () => setReady(true));
    // Phaser é carregado sob demanda para não pesar nas outras páginas.
    void import("./createOfficeGame").then(({ createOfficeGame }) => {
      if (!cancelled) game = createOfficeGame(el, bridge);
    });
    return () => {
      cancelled = true;
      off();
      game?.destroy(true);
    };
  }, [bridge]);
  return (
    <>
      <div ref={ref} className="absolute inset-0" data-testid="office-canvas" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center bg-[#1b1f2a] font-mono text-xs text-slate-400">Montando o escritório…</div>}
    </>
  );
}

export function OfficePage() {
  const bridge = useMemo(() => new OfficeBridge(), []);
  const socket = useOfficeRealtime(bridge);
  const agents = useQuery({ queryKey: ["office", "agents"], queryFn: () => api<Agent[]>("/api/office/agents"), refetchInterval: SAFETY_SYNC_MS });
  const tasks = useQuery({ queryKey: ["office", "tasks"], queryFn: () => api<Task[]>("/api/office/tasks?limit=100"), refetchInterval: SAFETY_SYNC_MS });
  const stats = useQuery({ queryKey: ["office", "stats"], queryFn: () => api<OfficeStats>("/api/office/stats"), refetchInterval: SAFETY_SYNC_MS });

  const [tab, setTab] = useState<Tab>("missions");
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [command, setCommand] = useState<{ open: boolean; agentId?: string | null }>({ open: false });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Tela cheia só do escritório; o Phaser reajusta o zoom sozinho no evento de resize.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => undefined);
  };

  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);

  // Envia ao jogo o estado real de cada agente (status do backend + progresso da tarefa atual).
  useEffect(() => {
    if (!agents.data) return;
    const list: OfficeAgent[] = agents.data.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      station: a.station,
      status: a.status,
      progress: a.currentTaskId ? (taskById.get(a.currentTaskId)?.progress ?? 0) : null,
    }));
    bridge.emitGame("sync", list);
  }, [agents.data, taskById, bridge]);

  useEffect(() => {
    const offs = [
      bridge.onUi("hover", setHover),
      bridge.onUi("click", (id) => { setSelected(id); setTab("agents"); }),
      bridge.onUi("dblclick", (id) => setDetails(id)),
    ];
    return () => offs.forEach((o) => o());
  }, [bridge]);

  useEffect(() => () => bridge.clear(), [bridge]);

  const agentMap = new Map((agents.data ?? []).map((a) => [a.id, a]));
  const selectedAgent = selected ? agentMap.get(selected) : undefined;
  const hoverAgent = hover ? agentMap.get(hover.id) : undefined;
  const s = stats.data;

  const kpis = [
    { icon: Users, label: "Online", value: s?.agentsOnline },
    { icon: Activity, label: "Trabalhando", value: s?.agentsWorking },
    { icon: Bot, label: "Disponíveis", value: s?.agentsAvailable },
    { icon: ListTodo, label: "Pendentes", value: s ? s.tasksQueued + s.tasksPaused : undefined },
    { icon: CheckCircle2, label: "Concluídas hoje", value: s?.completedToday },
    { icon: Gauge, label: "Sucesso hoje", value: s ? (s.successRateToday === null ? "—" : `${s.successRateToday}%`) : undefined },
    { icon: Clock, label: "Tempo médio", value: s ? formatDuration(s.avgRunMs) : undefined },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl bg-[#0F172A] p-4 text-white sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] shadow-lg shadow-indigo-500/30">
            <Bot className="size-5" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-bold tracking-[0.18em]">LEADHUNTER AI OFFICE</h1>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              {socket === "online" ? <Wifi className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-amber-400" />}
              {socket === "online" ? "Tempo real conectado" : socket === "connecting" ? "Conectando…" : "Reconectando ao tempo real"}
              <span className="text-slate-600">·</span> {agents.data?.length ?? 0} agentes <span className="text-slate-600">·</span> {s?.tasksRunning ?? 0} em execução
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button onClick={() => setCommand({ open: true })} className="flex-1 sm:flex-none"><Terminal /> Nova missão</Button>
          <Button asChild variant="ghost" size="icon" className="text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Configurações">
            <Link to="/configuracoes"><Settings /></Link>
          </Button>
        </div>
      </div>

      <ActiveMission onNew={() => setCommand({ open: true })} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {kpis.map((k) => (
          <Card key={k.label} className="flex items-center gap-2.5 p-3">
            <k.icon className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-[11px] text-muted">{k.label}</p>
              {k.value === undefined ? <Skeleton className="mt-1 h-4 w-8" /> : <p className="text-base font-semibold tabular-nums">{k.value}</p>}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card ref={stageRef} className="relative aspect-[13/7] w-full overflow-hidden bg-[#1b1f2a] [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none">
          {agents.isError ? (
            <ErrorState message={agents.error.message} onRetry={() => void agents.refetch()} />
          ) : (
            <GameCanvas bridge={bridge} />
          )}
          <div className="absolute right-3 top-3 flex flex-col gap-1">
            {([["in", ZoomIn, "Aproximar"], ["out", ZoomOut, "Afastar"], ["fit", Maximize2, "Ver escritório inteiro"], ["full", Expand, "Tela cheia"]] as const).map(([z, Icon, label]) => (
              <button key={z} type="button" onClick={() => (z === "full" ? toggleFullscreen() : bridge.emitGame("zoom", z))} aria-label={label} title={label}
                className="flex size-8 items-center justify-center rounded-lg bg-slate-900/80 text-slate-200 backdrop-blur transition-colors hover:bg-slate-800">
                <Icon className="size-4" />
              </button>
            ))}
          </div>
          <AnimatePresence>
            {hover && hoverAgent && (
              <motion.div
                key={hover.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-950/90 px-2.5 py-1.5 text-xs text-white shadow-lg"
                style={{ left: hover.x, top: hover.y - 6 }}
                role="tooltip"
              >
                <p className="font-semibold">{hoverAgent.name}</p>
                <p className="flex items-center gap-1.5 text-slate-300"><span className={cn("size-1.5 rounded-full", AGENT_STATUS_DOT[hoverAgent.status])} />{STATUS_LABEL[hoverAgent.status]}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-slate-500">Clique num agente para ver detalhes · duplo clique abre a ficha · role para zoom</p>
        </Card>

        <Card className="flex h-[70vh] flex-col overflow-hidden xl:h-0 xl:min-h-full">
          <div className="flex gap-1 overflow-x-auto border-b px-2 pt-2" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                className={cn("shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors", tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 p-3">
            {tab === "agents" && (
              selectedAgent ? (
                <div className="h-full overflow-y-auto">
                  <button type="button" onClick={() => setSelected(null)} className="mb-3 flex items-center gap-1 text-xs text-muted hover:text-foreground"><X className="size-3.5" /> Todos os agentes</button>
                  <AgentPanel
                    agent={selectedAgent}
                    task={selectedAgent.currentTaskId ? taskById.get(selectedAgent.currentTaskId) : undefined}
                    onAssign={() => setCommand({ open: true, agentId: selectedAgent.id })}
                    onShowTasks={() => { setAgentFilter(selectedAgent.id); setTab("tasks"); }}
                    onShowLogs={() => { setAgentFilter(selectedAgent.id); setTab("logs"); }}
                    onDetails={() => setDetails(selectedAgent.id)}
                  />
                </div>
              ) : agents.isPending ? (
                <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
              ) : (
                <ul className="space-y-2">
                  {agents.data?.map((a) => {
                    const t = a.currentTaskId ? taskById.get(a.currentTaskId) : undefined;
                    return (
                      <li key={a.id}>
                        <button type="button" onClick={() => { setSelected(a.id); bridge.emitGame("focus", a.id); }}
                          className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all hover:border-primary/40 hover:shadow-sm">
                          <AgentAvatar agent={a} />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm font-medium">{a.name}<span className={cn("size-2 rounded-full", AGENT_STATUS_DOT[a.status])} /></p>
                            <p className="truncate text-xs text-muted">{t ? t.title : STATUS_LABEL[a.status]}</p>
                            {t && <div className="mt-1.5 h-1 rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${t.progress}%` }} /></div>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
            {tab === "missions" && <MissionsView />}
            {tab === "tasks" && (
              <TasksView tasks={tasks.data} loading={tasks.isPending} onOpen={setOpenTask}
                agentFilter={agentFilter ? agentMap.get(agentFilter) : null} onClearAgent={() => setAgentFilter(null)} />
            )}
            {tab === "history" && <HistoryView tasks={tasks.data} onOpen={setOpenTask} />}
            {tab === "logs" && (
              <div className="flex h-full flex-col gap-2">
                {agentFilter && <button type="button" onClick={() => setAgentFilter(null)} className="self-start rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">{agentMap.get(agentFilter)?.name} ×</button>}
                <div className="min-h-0 flex-1"><LogsView agentFilter={agentFilter ? agentMap.get(agentFilter) : null} /></div>
              </div>
            )}
            {tab === "reports" && (
              <ReportsView tasks={tasks.data} onGenerate={() => setCommand({ open: true, agentId: agents.data?.find((a) => a.kind === "METRICS")?.id })} />
            )}
          </div>
        </Card>
      </div>

      <CommandCenter open={command.open} onOpenChange={(open) => setCommand((c) => ({ ...c, open }))} agents={agents.data ?? []} presetAgentId={command.agentId} />
      <TaskDialog taskId={openTask} onClose={() => setOpenTask(null)} />
      <AgentDetailsDialog agent={details ? (agentMap.get(details) ?? null) : null} tasks={tasks.data ?? []} onClose={() => setDetails(null)}
        onOpenTask={(id) => { setDetails(null); setOpenTask(id); }} />
    </div>
  );
}
