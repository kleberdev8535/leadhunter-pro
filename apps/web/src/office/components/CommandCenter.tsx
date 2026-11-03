import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { CheckCircle2, Info, Send, Terminal, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Badge } from "@/components/ui/primitives";
import { TASK_LABEL, type Agent, type Catalog, type Task, type TaskType } from "../types";

const STAGES = [
  { key: "new", label: "Leads novos" },
  { key: "qualified", label: "Lead qualificado" },
  { key: "first_contact", label: "Primeiro contato" },
  { key: "awaiting_reply", label: "Aguardando resposta" },
  { key: "negotiation", label: "Em negociação" },
  { key: "meeting", label: "Reunião agendada" },
  { key: "proposal", label: "Proposta enviada" },
];
const MESSAGE_KINDS = [
  { key: "INITIAL", label: "Mensagem inicial" },
  { key: "NO_WEBSITE", label: "Empresa sem site informado" },
  { key: "FOLLOW_UP", label: "Follow-up" },
  { key: "MEETING", label: "Agendar reunião" },
  { key: "PROPOSAL", label: "Apresentação de proposta" },
  { key: "CLOSING", label: "Encerramento profissional" },
];
const QUANTITIES = [10, 25, 50, 100, 250];

interface Form {
  niches: string[];
  customNiche: string;
  city: string;
  state: string;
  neighborhood: string;
  quantity: number;
  website: "any" | "with" | "without";
  requirePhone: boolean;
  minRating: string;
  minReviews: string;
  onlyNotInCrm: boolean;
  searchTaskId: string;
  sourceKind: "search" | "stage";
  stageKey: string;
  targetCities: string;
  onlyWithoutWebsite: boolean;
  moveQualified: boolean;
  messageKind: string;
  senderName: string;
  serviceOffered: string;
  minScore: number;
  limit: number;
  days: 7 | 30 | 90;
  olderThanDays: number;
}

const initialForm: Form = {
  niches: ["barbearias"], customNiche: "", city: "", state: "SP", neighborhood: "", quantity: 50, website: "any",
  requirePhone: false, minRating: "", minReviews: "", onlyNotInCrm: true, searchTaskId: "", sourceKind: "search",
  stageKey: "new", targetCities: "", onlyWithoutWebsite: false, moveQualified: true, messageKind: "INITIAL",
  senderName: "", serviceOffered: "desenvolvimento de sites e soluções digitais", minScore: 0, limit: 20, days: 30, olderThanDays: 30,
};

/** Modelos de comando: preenchem o formulário; quem executa são sempre os campos validados. */
const PRESETS: { label: string; type: TaskType; patch: Partial<Form> }[] = [
  { label: "50 barbearias em Osasco sem site", type: "SEARCH_LEADS", patch: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 50, website: "without" } },
  { label: "25 clínicas odontológicas com telefone", type: "SEARCH_LEADS", patch: { niches: ["odonto"], quantity: 25, requirePhone: true, website: "any" } },
  { label: "Relatório dos últimos 30 dias", type: "GENERATE_REPORT", patch: { days: 30 } },
  { label: "Qualificar leads novos", type: "QUALIFY_LEADS", patch: { sourceKind: "stage", stageKey: "new" } },
];

function buildPayload(type: TaskType, f: Form): { parameters: Record<string, unknown> } | { error: string } {
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  switch (type) {
    case "SEARCH_LEADS":
      if (!f.city.trim() || !f.state.trim()) return { error: "Informe cidade e estado" };
      if (f.niches.length === 0 && !f.customNiche.trim()) return { error: "Escolha ao menos um nicho" };
      if (f.niches.length === 0) return { error: "Escolha ao menos um nicho da lista (o personalizado é complementar)" };
      if (!Number.isInteger(f.quantity) || f.quantity < 1 || f.quantity > 250) return { error: "Quantidade entre 1 e 250" };
      return {
        parameters: {
          niches: f.niches, customNiche: f.customNiche.trim() || undefined, city: f.city.trim(), state: f.state.trim(),
          neighborhood: f.neighborhood.trim() || undefined, quantity: f.quantity, website: f.website, requirePhone: f.requirePhone,
          minRating: num(f.minRating), minReviews: num(f.minReviews), onlyNotInCrm: f.onlyNotInCrm,
        },
      };
    case "IMPORT_TO_CRM":
      if (!f.searchTaskId) return { error: "Escolha a busca que será importada" };
      return { parameters: { searchTaskId: f.searchTaskId, onlyWithoutWebsite: f.onlyWithoutWebsite, moveQualifiedMinScore: f.moveQualified ? 60 : undefined } };
    case "QUALIFY_LEADS":
      if (f.sourceKind === "search" && !f.searchTaskId) return { error: "Escolha a busca de origem" };
      return {
        parameters: {
          source: f.sourceKind === "search" ? { kind: "search", searchTaskId: f.searchTaskId } : { kind: "stage", stageKey: f.stageKey },
          targetCities: f.targetCities.split(",").map((s) => s.trim()).filter(Boolean),
        },
      };
    case "GENERATE_MESSAGES":
      if (!f.senderName.trim() || !f.serviceOffered.trim()) return { error: "Informe seu nome e o serviço oferecido" };
      return { parameters: { kind: f.messageKind, senderName: f.senderName.trim(), serviceOffered: f.serviceOffered.trim(), stageKey: f.stageKey, minScore: f.minScore, limit: f.limit } };
    case "GENERATE_REPORT":
      return { parameters: { days: f.days } };
    case "UPDATE_LEADS":
      return { parameters: { olderThanDays: f.olderThanDays, limit: f.limit } };
  }
}

const selectCls = "h-10 w-full rounded-lg border bg-surface px-3 text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

export function CommandCenter({
  open,
  onOpenChange,
  agents,
  presetAgentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agents: Agent[];
  presetAgentId?: string | null;
}) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["office", "catalog"], queryFn: () => api<Catalog>("/api/office/catalog"), staleTime: Infinity });
  const searches = useQuery({
    queryKey: ["office", "searches"],
    queryFn: () => api<Task[]>("/api/office/tasks?status=COMPLETED&limit=100"),
    enabled: open,
    select: (list) => list.filter((t) => t.taskType === "SEARCH_LEADS"),
  });

  const [agentId, setAgentId] = useState<string>("");
  // Padrão: missão da equipe inteira. Tarefa avulsa fica como opção avançada.
  const [mode, setMode] = useState<"team" | "single">("team");
  const [team, setTeam] = useState({ minScore: 40, writeMessages: true, report: true });
  const [teamDone, setTeamDone] = useState<{ title: string } | null>(null);
  const [chosenType, setType] = useState<TaskType>("SEARCH_LEADS");
  const [form, setForm] = useState<Form>(initialForm);
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  const [confirmed, setConfirmed] = useState<{ task: Task; duplicate: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const types = useMemo(() => agent?.supports ?? [], [agent]);
  // O tipo sempre pertence ao agente escolhido, mesmo se a lista de agentes for atualizada.
  const singleType: TaskType = types.includes(chosenType) ? chosenType : (types[0] ?? chosenType);
  const type: TaskType = mode === "team" ? "SEARCH_LEADS" : singleType;

  // Inicializa só quando o modal abre; atualizações da lista de agentes (tempo real) não apagam o formulário.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  useEffect(() => {
    if (!open) return;
    // Cada abertura é um envio novo: chave de idempotência nova.
    setKey(crypto.randomUUID());
    setConfirmed(null);
    setTeamDone(null);
    setError(null);
    setMode(presetAgentId ? "single" : "team");
    const preset = agentsRef.current.find((a) => a.id === presetAgentId) ?? agentsRef.current[0];
    if (preset) {
      setAgentId(preset.id);
      setType(preset.supports[0]!);
    }
  }, [open, presetAgentId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Task>("/api/office/tasks", { method: "POST", body }),
    onSuccess: (task) => {
      // Reenvio com a mesma chave devolve a mesma tarefa no backend; aqui só confirmamos.
      const duplicate = false;
      setConfirmed({ task, duplicate });
      void qc.invalidateQueries({ queryKey: ["office"] });
      toast.success(duplicate ? "Essa tarefa já tinha sido enviada" : `Tarefa enviada para ${task.agentName}`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError && err.details?.length ? err.details.map((d) => `${d.path}: ${d.message}`).join(" · ") : err.message;
      setError(msg);
    },
  });

  const startTeam = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ id: string; title: string }>("/api/office/team-runs", { method: "POST", body }),
    onSuccess: (run) => {
      setTeamDone({ title: run.title });
      void qc.invalidateQueries({ queryKey: ["office"] });
      toast.success("Missão iniciada: o Hunter começou a prospectar");
    },
    onError: (err) => setError(err instanceof ApiError && err.details?.length ? err.details.map((d) => `${d.path}: ${d.message}`).join(" · ") : err.message),
  });

  const send = () => {
    setError(null);
    if (mode === "team") {
      const built = buildPayload("SEARCH_LEADS", form);
      if ("error" in built) return setError(built.error);
      return startTeam.mutate({
        search: built.parameters,
        minScore: team.minScore,
        // Sem site informado → mensagem que fala disso; caso contrário, apresentação padrão.
        messageKind: form.website === "without" ? "NO_WEBSITE" : "INITIAL",
        writeMessages: team.writeMessages,
        report: team.report,
        description: notes.trim() || undefined,
        idempotencyKey,
      });
    }
    const built = buildPayload(type, form);
    if ("error" in built) return setError(built.error);
    submit.mutate({ taskType: type, ...built, description: notes.trim() || undefined, idempotencyKey });
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const target = agents.find((a) => a.supports.includes(p.type));
    if (target) setAgentId(target.id);
    setType(p.type);
    setForm((f) => ({ ...f, ...p.patch }));
  };

  const niches = catalog.data?.niches ?? [];
  const maxPerQuery = catalog.data?.limits.maxResultsPerQuery ?? 60;

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-surface shadow-2xl">
          <div className="flex items-center gap-3 border-b bg-[#0F172A] px-5 py-4 text-white">
            <div className="flex size-9 items-center justify-center rounded-lg bg-white/10">
              <Terminal className="size-4.5 text-indigo-300" />
            </div>
            <div className="flex-1">
              <D.Title className="font-mono text-sm font-semibold tracking-[0.2em]">CENTRAL DE COMANDO</D.Title>
              <D.Description className="text-xs text-slate-400">Tarefas predefinidas com parâmetros validados. Nada é interpretado livremente.</D.Description>
            </div>
            <D.Close asChild>
              <button className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </D.Close>
          </div>

          {teamDone ? (
            <div className="space-y-4 p-6 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" />
              <div>
                <p className="font-semibold">Missão iniciada</p>
                <p className="mt-1 text-sm text-muted">{teamDone.title}</p>
                <p className="mt-1 text-xs text-muted">Hunter → Scout → Atlas{team.writeMessages ? " → Writer" : ""}{team.report ? " → Metrics" : ""}. Cada um começa quando o anterior termina.</p>
              </div>
              <Button onClick={() => onOpenChange(false)}>Acompanhar no escritório</Button>
            </div>
          ) : confirmed ? (
            <div className="space-y-4 p-6 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" />
              <div>
                <p className="font-semibold">{confirmed.duplicate ? "Tarefa já estava na fila" : "Tarefa enviada"}</p>
                <p className="mt-1 text-sm text-muted">{confirmed.task.title}</p>
                <p className="mt-1 text-xs text-muted">Responsável: {confirmed.task.agentName} · acompanhe no escritório em tempo real.</p>
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="secondary" onClick={() => { setConfirmed(null); setKey(crypto.randomUUID()); }}>Nova tarefa</Button>
                <Button onClick={() => onOpenChange(false)}>Ver no escritório</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5 overflow-y-auto p-5">
              <div role="radiogroup" aria-label="Modo" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
                {([["team", "Missão da equipe", "Os 5 agentes em sequência"], ["single", "Tarefa avulsa", "Um agente específico"]] as const).map(([m, label, hint]) => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                    className={cn("rounded-lg px-3 py-2 text-left transition-colors", mode === m ? "bg-surface shadow-sm" : "text-muted hover:text-foreground")}>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[11px] text-muted">{hint}</span>
                  </button>
                ))}
              </div>

              {mode === "team" && (
                <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                  {[["Hunter", "prospecta"], ["Scout", "qualifica"], ["Atlas", "registra no CRM"], ...(team.writeMessages ? [["Writer", "prepara mensagens"]] : []), ...(team.report ? [["Metrics", "relatório"]] : [])].map(([n, d], i, arr) => (
                    <li key={n} className="flex items-center gap-1.5">
                      <span className="rounded-full bg-primary-soft px-2.5 py-1 font-medium text-primary">{n} <span className="font-normal text-muted">· {d}</span></span>
                      {i < arr.length - 1 && <span className="text-muted">→</span>}
                    </li>
                  ))}
                </ol>
              )}

              <div className={cn(mode === "team" && "hidden")}>
                <p className="mb-2 text-xs font-medium text-muted">Modelos de comando</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => applyPreset(p)} className="rounded-full border bg-surface-muted px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Observações" htmlFor="notes" hint={<span className="text-[11px] text-muted">Só anotação, não altera a execução</span>}>
                <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder="Descreva a tarefa que deseja executar..." className={cn(selectCls, "h-auto py-2")} />
              </Field>

              <div className={cn("grid gap-4 sm:grid-cols-2", mode === "team" && "hidden")}>
                <Field label="Agente" htmlFor="agent">
                  <select id="agent" className={selectCls} value={agent?.id ?? ""} onChange={(e) => { setAgentId(e.target.value); const a = agents.find((x) => x.id === e.target.value); if (a) setType(a.supports[0]!); }}>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role.split(" — ")[0]}</option>)}
                  </select>
                </Field>
                <Field label="Tipo de tarefa" htmlFor="type">
                  <select id="type" className={selectCls} value={type} onChange={(e) => setType(e.target.value as TaskType)}>
                    {types.map((t) => <option key={t} value={t}>{TASK_LABEL[t]}</option>)}
                  </select>
                </Field>
              </div>

              {type === "SEARCH_LEADS" && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-sm font-medium">Nichos <span className="text-xs font-normal text-muted">(até 5)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {niches.map((n) => {
                        const on = form.niches.includes(n.key);
                        return (
                          <button key={n.key} type="button" aria-pressed={on}
                            onClick={() => set("niches", on ? form.niches.filter((k) => k !== n.key) : form.niches.length < 5 ? [...form.niches, n.key] : form.niches)}
                            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary-soft text-primary" : "hover:border-primary/50")}>
                            {n.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Cidade" htmlFor="city"><Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Osasco" /></Field>
                    <Field label="Estado" htmlFor="state"><Input id="state" value={form.state} onChange={(e) => set("state", e.target.value)} /></Field>
                    <Field label="Bairro (opcional)" htmlFor="nb"><Input id="nb" value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} /></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Quantidade" htmlFor="qty">
                      <div className="flex gap-1.5">
                        {QUANTITIES.map((q) => (
                          <button key={q} type="button" onClick={() => set("quantity", q)} className={cn("h-10 flex-1 rounded-lg border text-sm", form.quantity === q ? "border-primary bg-primary-soft text-primary" : "")}>{q}</button>
                        ))}
                        <Input id="qty" type="number" min={1} max={250} value={form.quantity} onChange={(e) => set("quantity", Number(e.target.value))} className="w-20" aria-label="Quantidade personalizada" />
                      </div>
                    </Field>
                    <Field label="Site" htmlFor="site">
                      <select id="site" className={selectCls} value={form.website} onChange={(e) => set("website", e.target.value as Form["website"])}>
                        <option value="any">Qualquer</option>
                        <option value="without">Sem site informado no Google</option>
                        <option value="with">Com site</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Nicho personalizado" htmlFor="cn"><Input id="cn" value={form.customNiche} onChange={(e) => set("customNiche", e.target.value)} placeholder="ex.: estúdio de tatuagem" /></Field>
                    <Field label="Avaliação mínima" htmlFor="mr"><Input id="mr" type="number" step="0.1" min={0} max={5} value={form.minRating} onChange={(e) => set("minRating", e.target.value)} /></Field>
                    <Field label="Mín. de avaliações" htmlFor="mv"><Input id="mv" type="number" min={0} value={form.minReviews} onChange={(e) => set("minReviews", e.target.value)} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Toggle checked={form.requirePhone} onChange={(v) => set("requirePhone", v)} label="Só com telefone" />
                    <Toggle checked={form.onlyNotInCrm} onChange={(v) => set("onlyNotInCrm", v)} label="Só empresas ainda não cadastradas" />
                  </div>
                  <p className="flex gap-2 rounded-lg bg-surface-muted p-3 text-xs text-muted">
                    <Info className="size-4 shrink-0" />
                    O Google devolve no máximo {maxPerQuery} lugares por nicho e região. "Sem site" significa que o Google não informou um site — não garante que a empresa não tenha.
                  </p>
                </div>
              )}

              {(type === "IMPORT_TO_CRM" || (type === "QUALIFY_LEADS" && form.sourceKind === "search")) && (
                <Field label="Busca de origem" htmlFor="src">
                  <select id="src" className={selectCls} value={form.searchTaskId} onChange={(e) => set("searchTaskId", e.target.value)}>
                    <option value="">{searches.data?.length ? "Selecione…" : "Nenhuma busca concluída ainda"}</option>
                    {searches.data?.map((s) => <option key={s.id} value={s.id}>{s.title} — {String((s.result as { saved?: number } | null)?.saved ?? 0)} lugares</option>)}
                  </select>
                </Field>
              )}

              {type === "IMPORT_TO_CRM" && (
                <div className="flex flex-wrap gap-4">
                  <Toggle checked={form.onlyWithoutWebsite} onChange={(v) => set("onlyWithoutWebsite", v)} label="Importar só sem site informado" />
                  <Toggle checked={form.moveQualified} onChange={(v) => set("moveQualified", v)} label="Mover score ≥ 60 para Qualificado" />
                </div>
              )}

              {type === "QUALIFY_LEADS" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Leads a avaliar" htmlFor="sk">
                    <select id="sk" className={selectCls} value={form.sourceKind} onChange={(e) => set("sourceKind", e.target.value as Form["sourceKind"])}>
                      <option value="search">De uma busca</option>
                      <option value="stage">De uma etapa do CRM</option>
                    </select>
                  </Field>
                  {form.sourceKind === "stage" && (
                    <Field label="Etapa" htmlFor="st">
                      <select id="st" className={selectCls} value={form.stageKey} onChange={(e) => set("stageKey", e.target.value)}>
                        {STAGES.slice(0, 4).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Cidades-alvo (separadas por vírgula)" htmlFor="tc"><Input id="tc" value={form.targetCities} onChange={(e) => set("targetCities", e.target.value)} placeholder="Osasco, Barueri" /></Field>
                </div>
              )}

              {type === "GENERATE_MESSAGES" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tipo de mensagem" htmlFor="mk">
                    <select id="mk" className={selectCls} value={form.messageKind} onChange={(e) => set("messageKind", e.target.value)}>
                      {MESSAGE_KINDS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Etapa dos leads" htmlFor="ms">
                    <select id="ms" className={selectCls} value={form.stageKey} onChange={(e) => set("stageKey", e.target.value)}>
                      {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Seu nome" htmlFor="sn"><Input id="sn" value={form.senderName} onChange={(e) => set("senderName", e.target.value)} placeholder="Lucas" /></Field>
                  <Field label="Score mínimo" htmlFor="msc"><Input id="msc" type="number" min={0} max={100} value={form.minScore} onChange={(e) => set("minScore", Number(e.target.value))} /></Field>
                  <div className="sm:col-span-2">
                    <Field label="Serviço oferecido" htmlFor="so"><Input id="so" value={form.serviceOffered} onChange={(e) => set("serviceOffered", e.target.value)} /></Field>
                  </div>
                  <p className="text-xs text-muted sm:col-span-2">O Writer usa templates fixos (sem IA) e só cria rascunhos. Nada é enviado.</p>
                </div>
              )}

              {type === "GENERATE_REPORT" && (
                <Field label="Período" htmlFor="days">
                  <select id="days" className={selectCls} value={form.days} onChange={(e) => set("days", Number(e.target.value) as Form["days"])}>
                    <option value={7}>Últimos 7 dias</option>
                    <option value={30}>Últimos 30 dias</option>
                    <option value={90}>Últimos 90 dias</option>
                  </select>
                </Field>
              )}

              {type === "UPDATE_LEADS" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Dados com mais de (dias)" htmlFor="od"><Input id="od" type="number" min={0} max={365} value={form.olderThanDays} onChange={(e) => set("olderThanDays", Number(e.target.value))} /></Field>
                  <Field label="Máximo de leads" htmlFor="lm"><Input id="lm" type="number" min={1} max={100} value={form.limit} onChange={(e) => set("limit", Number(e.target.value))} /></Field>
                </div>
              )}

              {mode === "team" && (
                <div className="space-y-3 rounded-xl border p-4">
                  <p className="text-sm font-medium">Como a equipe deve trabalhar</p>
                  <Field label={`Score mínimo para o Atlas registrar no CRM: ${team.minScore}`} htmlFor="tm-score"
                    hint={<span className="text-[11px] text-muted">≥ 60 já entra como "Lead qualificado"</span>}>
                    <input id="tm-score" type="range" min={0} max={100} step={5} value={team.minScore} onChange={(e) => setTeam({ ...team, minScore: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
                  </Field>
                  <div className="flex flex-wrap gap-4">
                    <Toggle checked={team.writeMessages} onChange={(v) => setTeam({ ...team, writeMessages: v })} label="Writer prepara as mensagens (rascunhos, nada é enviado)" />
                    <Toggle checked={team.report} onChange={(v) => setTeam({ ...team, report: v })} label="Metrics gera o relatório no final" />
                  </div>
                </div>
              )}

              {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
            </div>
          )}

          {!confirmed && !teamDone && (
            <div className="flex items-center justify-between gap-3 border-t bg-surface-muted/50 px-5 py-3">
              <span className="text-xs text-muted">{mode === "team" ? <>Responsável: <Badge tone="primary">Equipe completa</Badge></> : agent && <>Responsável: <Badge tone="primary">{agent.name}</Badge></>}</span>
              <Button onClick={send} loading={submit.isPending || startTeam.isPending}>
                <Send /> {mode === "team" ? "Iniciar missão" : "Enviar tarefa"}
              </Button>
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
