import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { CalendarClock, Flame, Globe, GlobeLock, KanbanSquare, MessageCircle, Phone, Plus, Search, User } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Field, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/states";
import { LeadDrawer } from "./LeadDrawer";
import { whatsappLink, type FilterOptions, type LeadCard, type Stage } from "./types";

const FILTER_KEY = "lh-crm-filters";
interface Filters {
  q: string;
  niche: string;
  city: string;
  ownerId: string;
  tagId: string;
  sort: "recent" | "oldest" | "score" | "lastContact";
}
const EMPTY: Filters = { q: "", niche: "", city: "", ownerId: "", tagId: "", sort: "recent" };
const selectCls = "h-9 rounded-lg border bg-surface px-2.5 text-sm shadow-xs focus:border-primary focus:outline-none";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CardBody({ lead, dragging }: { lead: LeadCard; dragging?: boolean }) {
  const wa = whatsappLink(lead.phoneE164);
  const overdue = lead.nextTask && new Date(lead.nextTask.dueAt) < new Date();
  return (
    <div className={cn("rounded-xl border bg-surface p-3 text-left shadow-xs transition-shadow", dragging ? "rotate-2 shadow-xl ring-2 ring-primary/40" : "hover:shadow-md")}>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{lead.companyName}</p>
        {lead.interest === "HIGH" && <Flame className="size-4 shrink-0 text-orange-500" aria-label="Interesse alto" />}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted">{[lead.niche, lead.city].filter(Boolean).join(" · ") || "Sem nicho/cidade"}</p>
      {lead.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.tags.slice(0, 3).map((t) => (
            <span key={t.id} className="rounded-full px-1.5 py-px text-[10px] font-medium" style={{ color: t.color, background: `${t.color}1a` }}>{t.name}</span>
          ))}
        </div>
      )}
      <div className="mt-2.5 space-y-1 text-[11px] text-muted">
        {lead.phone && <p className="flex items-center gap-1.5"><Phone className="size-3" />{lead.phone}</p>}
        <p className="flex items-center gap-1.5">
          {lead.website ? <><Globe className="size-3 text-success" /> Tem site</> : <><GlobeLock className="size-3" /> Sem site informado</>}
        </p>
        {lead.nextTask && (
          <p className={cn("flex items-center gap-1.5", overdue && "font-medium text-danger")}>
            <CalendarClock className="size-3" />{lead.nextTask.title} · {new Date(lead.nextTask.dueAt).toLocaleDateString("pt-BR")}
          </p>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t pt-2 text-[11px] text-muted">
        <span className="flex items-center gap-1"><User className="size-3" />{lead.owner?.name.split(" ")[0] ?? "—"}</span>
        <span>{lead.lastContactAt ? `contato ${formatRelative(lead.lastContactAt)}` : "sem contato"}</span>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            className="rounded-md p-1 text-[#25D366] hover:bg-[#25D366]/10" aria-label={`WhatsApp de ${lead.companyName}`}>
            <MessageCircle className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ lead, onOpen }: { lead: LeadCard; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, data: { stageId: lead.stageId } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => onOpen(lead.id)} className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-30")}
      aria-roledescription="card arrastável" data-testid={`lead-${lead.companyName}`}>
      <CardBody lead={lead} />
    </div>
  );
}

function Column({ stage, leads, onOpen }: { stage: Stage; leads: LeadCard[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section className="flex w-72 shrink-0 flex-col" aria-label={stage.name} data-testid={`column-${stage.key}`}>
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className="size-2.5 rounded-full" style={{ background: stage.color }} />
        <h2 className="text-sm font-semibold">{stage.name}</h2>
        <span className="rounded-full bg-surface-muted px-2 text-xs tabular-nums text-muted">{leads.length}</span>
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto rounded-2xl bg-surface-muted/60 p-2 transition-colors", isOver && "bg-primary-soft ring-2 ring-primary/30")}>
        {leads.map((l) => <DraggableCard key={l.id} lead={l} onOpen={onOpen} />)}
        {leads.length === 0 && <p className="py-6 text-center text-xs text-muted">Arraste leads para cá</p>}
      </div>
    </section>
  );
}

function NewLeadDialog({ open, onOpenChange, stages }: { open: boolean; onOpenChange: (o: boolean) => void; stages: Stage[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ companyName: "", contactName: "", phone: "", email: "", niche: "", city: "", state: "", website: "", stageId: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const create = useMutation({
    mutationFn: () => api("/api/crm/leads", { method: "POST", body: { ...f, stageId: f.stageId || undefined } }),
    onSuccess: () => {
      toast.success("Lead criado");
      void qc.invalidateQueries({ queryKey: ["crm"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setF({ companyName: "", contactName: "", phone: "", email: "", niche: "", city: "", state: "", website: "", stageId: "" });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Novo lead" description="Cadastro manual. Leads do Google Maps entram pela tela Encontrar Leads." className="max-w-lg">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.companyName.trim().length >= 2) create.mutate(); }}>
        <Field label="Empresa *" htmlFor="n-company"><Input id="n-company" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contato" htmlFor="n-contact"><Input id="n-contact" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
          <Field label="Telefone" htmlFor="n-phone"><Input id="n-phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(11) 99999-9999" /></Field>
          <Field label="Email" htmlFor="n-email"><Input id="n-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Nicho" htmlFor="n-niche"><Input id="n-niche" value={f.niche} onChange={(e) => set("niche", e.target.value)} /></Field>
          <Field label="Cidade" htmlFor="n-city"><Input id="n-city" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Estado" htmlFor="n-state"><Input id="n-state" value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
        </div>
        <Field label="Website" htmlFor="n-site"><Input id="n-site" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
        <Field label="Etapa" htmlFor="n-stage">
          <select id="n-stage" className={cn(selectCls, "h-10 w-full")} value={f.stageId} onChange={(e) => set("stageId", e.target.value)}>
            <option value="">Leads novos</option>
            {stages.slice(1).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" loading={create.isPending} disabled={f.companyName.trim().length < 2}>Criar lead</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CrmPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return { ...EMPTY, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") };
    } catch {
      return EMPTY;
    }
  });
  useEffect(() => localStorage.setItem(FILTER_KEY, JSON.stringify(filters)), [filters]);
  const q = useDebounced(filters.q);
  const params = new URLSearchParams(Object.entries({ ...filters, q }).filter(([, v]) => v) as [string, string][]).toString();

  const pipeline = useQuery({ queryKey: ["crm", "pipeline"], queryFn: () => api<{ stages: Stage[] }>("/api/crm/pipeline"), staleTime: 5 * 60_000 });
  const options = useQuery({ queryKey: ["crm", "filters"], queryFn: () => api<FilterOptions>("/api/crm/filters") });
  const leads = useQuery({ queryKey: ["crm", "leads", params], queryFn: () => api<LeadCard[]>(`/api/crm/leads?${params}`), placeholderData: (prev) => prev });

  const [urlParams, setUrlParams] = useSearchParams();
  const [openLead, setOpenLead] = useState<string | null>(null);
  // Abre o lead vindo de links (?lead=…), inclusive quando já se está no CRM.
  useEffect(() => {
    const id = urlParams.get("lead");
    if (id) {
      setOpenLead(id);
      setUrlParams({}, { replace: true });
    }
  }, [urlParams, setUrlParams]);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<LeadCard | null>(null);

  const byStage = useMemo(() => {
    const m = new Map<string, LeadCard[]>();
    for (const l of leads.data ?? []) m.set(l.stageId, [...(m.get(l.stageId) ?? []), l]);
    return m;
  }, [leads.data]);

  const move = useMutation({
    mutationFn: ({ id, stageId, index }: { id: string; stageId: string; index: number }) => api(`/api/crm/leads/${id}/move`, { method: "POST", body: { stageId, index } }),
    // Atualização otimista: o card muda de coluna na hora; se a API falhar, volta.
    onMutate: async ({ id, stageId, index }) => {
      const key = ["crm", "leads", params];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LeadCard[]>(key);
      qc.setQueryData<LeadCard[]>(key, (list) => {
        if (!list) return list;
        const card = list.find((l) => l.id === id);
        if (!card) return list;
        const rest = list.filter((l) => l.id !== id);
        const col = rest.filter((l) => l.stageId === stageId);
        const anchor = col[index];
        const at = anchor ? rest.indexOf(anchor) : rest.length;
        return [...rest.slice(0, at), { ...card, stageId }, ...rest.slice(at)];
      });
      return { prev, key };
    },
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["crm"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const onDragStart = (e: DragStartEvent) => setDragging((leads.data ?? []).find((l) => l.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over) return;
    const id = String(e.active.id);
    const overId = String(e.over.id);
    const stages = pipeline.data?.stages ?? [];
    const overLead = (leads.data ?? []).find((l) => l.id === overId);
    const stageId = stages.some((s) => s.id === overId) ? overId : overLead?.stageId;
    if (!stageId) return;
    const col = (byStage.get(stageId) ?? []).filter((l) => l.id !== id);
    const index = overLead ? Math.max(0, col.findIndex((l) => l.id === overLead.id)) : col.length;
    const current = (leads.data ?? []).find((l) => l.id === id);
    if (current?.stageId === stageId && !overLead) return;
    move.mutate({ id, stageId, index });
  };

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const active = Object.entries(filters).some(([k, v]) => k !== "sort" && v);
  const total = leads.data?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CRM Kanban</h1>
          <p className="mt-1 text-sm text-muted">{total} lead{total === 1 ? "" : "s"} no funil. Arraste os cards entre as etapas.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus /> Novo lead</Button>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Empresa, contato ou telefone…" className="h-9 pl-9" aria-label="Pesquisar leads" />
        </div>
        <select className={selectCls} value={filters.niche} onChange={(e) => set("niche", e.target.value)} aria-label="Nicho">
          <option value="">Todos os nichos</option>
          {options.data?.niches.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select className={selectCls} value={filters.city} onChange={(e) => set("city", e.target.value)} aria-label="Cidade">
          <option value="">Todas as cidades</option>
          {options.data?.cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={selectCls} value={filters.ownerId} onChange={(e) => set("ownerId", e.target.value)} aria-label="Responsável">
          <option value="">Todos os responsáveis</option>
          {options.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className={selectCls} value={filters.tagId} onChange={(e) => set("tagId", e.target.value)} aria-label="Etiqueta">
          <option value="">Todas as etiquetas</option>
          {options.data?.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={selectCls} value={filters.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])} aria-label="Ordenação">
          <option value="recent">Ordem do quadro</option>
          <option value="oldest">Mais antigos</option>
          <option value="score">Maior score</option>
          <option value="lastContact">Último contato</option>
        </select>
        {active && <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>Limpar filtros</Button>}
      </Card>

      {pipeline.isError || leads.isError ? (
        <Card><ErrorState message={(pipeline.error ?? leads.error)!.message} onRetry={() => { void pipeline.refetch(); void leads.refetch(); }} /></Card>
      ) : pipeline.isPending || leads.isPending ? (
        <div className="flex gap-3 overflow-hidden">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-2xl" />)}</div>
      ) : total === 0 && !active ? (
        <Card>
          <EmptyState icon={KanbanSquare} title="Seu funil está vazio" description="Adicione leads encontrados no Google Maps ou cadastre um lead manualmente."
            action={<Button onClick={() => setCreating(true)}><Plus /> Novo lead</Button>} />
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="-mx-4 flex h-[calc(100dvh-17rem)] min-h-[420px] gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            {pipeline.data.stages.map((s) => <Column key={s.id} stage={s} leads={byStage.get(s.id) ?? []} onOpen={setOpenLead} />)}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>{dragging && <div className="w-72"><CardBody lead={dragging} dragging /></div>}</DragOverlay>
        </DndContext>
      )}

      <NewLeadDialog open={creating} onOpenChange={setCreating} stages={pipeline.data?.stages ?? []} />
      <LeadDrawer leadId={openLead} onClose={() => setOpenLead(null)} options={options.data} />
    </div>
  );
}
