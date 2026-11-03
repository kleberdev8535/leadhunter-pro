import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Bookmark, Check, CheckCheck, Clock, FileText, MessageSquarePlus, Pause, Play, Search, Send, ShieldAlert, AlertCircle, CalendarPlus, ExternalLink, Wand2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Skeleton } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states";
import type { WaStatus } from "../whatsapp/WhatsAppPage";

interface Msg {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: "DRAFT" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";
  error: string | null;
  sendAfter: string | null;
  sentAt: string | null;
  createdAt: string;
}
interface Conversation {
  id: string;
  contactPhone: string;
  lead: { id: string; companyName: string; city: string | null; niche: string | null } | null;
  unreadCount: number;
  sequencePaused: boolean;
  lastMessageAt: string | null;
  lastMessage: Msg | null;
}
interface Thread {
  conversation: {
    id: string;
    contactPhone: string;
    sequencePaused: boolean;
    blocked: boolean;
    lead: { id: string; companyName: string; phone: string | null; city: string | null; niche: string | null; website: string | null; consentBasis: string; stage: { name: string } } | null;
  };
  messages: Msg[];
}
const COMPOSE_KINDS = [
  { key: "INITIAL", label: "Mensagem inicial" },
  { key: "NO_WEBSITE", label: "Sem site informado" },
  { key: "FOLLOW_UP", label: "Follow-up" },
  { key: "MEETING", label: "Convite para reunião" },
  { key: "PROPOSAL", label: "Apresentar proposta" },
  { key: "CLOSING", label: "Encerramento" },
] as const;
interface Template { id: string; name: string; body: string }

interface LeadLite { id: string; companyName: string; phone: string | null; phoneE164: string | null; city: string | null; niche: string | null }

function StatusIcon({ m }: { m: Msg }) {
  if (m.status === "QUEUED") return <span title={m.sendAfter ? `Na fila: sai às ${new Date(m.sendAfter).toLocaleTimeString("pt-BR")}` : "Na fila"}><Clock className="size-3.5" /></span>;
  if (m.status === "SENT") return <Check className="size-3.5" aria-label="Enviada" />;
  if (m.status === "DELIVERED") return <CheckCheck className="size-3.5" aria-label="Entregue" />;
  if (m.status === "READ") return <CheckCheck className="size-3.5 text-sky-500" aria-label="Lida" />;
  if (m.status === "FAILED") return <span title={m.error ?? "Falhou"}><AlertCircle className="size-3.5 text-danger" /></span>;
  return null;
}

function NewConversation({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (lead: LeadLite) => void }) {
  const [q, setQ] = useState("");
  const leads = useQuery({
    queryKey: ["crm", "leads", "picker", q],
    queryFn: () => api<LeadLite[]>(`/api/crm/leads?limit=30${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nova conversa" description="Escolha um lead do CRM. Só leads com telefone podem receber mensagem.">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Empresa ou telefone…" className="pl-9" aria-label="Buscar lead" />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {leads.data?.map((l) => (
            <li key={l.id}>
              <button type="button" disabled={!l.phoneE164} onClick={() => onPick(l)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:opacity-40">
                <span><span className="font-medium">{l.companyName}</span><span className="block text-xs text-muted">{[l.niche, l.city].filter(Boolean).join(" · ")}</span></span>
                <span className="text-xs text-muted">{l.phone ?? "sem telefone"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

export function MessagesPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const leadParam = params.get("lead");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingLead, setPendingLead] = useState<LeadLite | null>(null);
  const [text, setText] = useState("");
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState("");
  const [legalPrompt, setLegalPrompt] = useState(false);
  const keyRef = useRef(crypto.randomUUID());
  const [composeKind, setComposeKind] = useState<(typeof COMPOSE_KINDS)[number]["key"]>("INITIAL");
  const templates = useQuery({ queryKey: ["whatsapp", "templates"], queryFn: () => api<Template[]>("/api/whatsapp/templates") });
  const bottomRef = useRef<HTMLDivElement>(null);

  const wa = useQuery({ queryKey: ["whatsapp", "status"], queryFn: () => api<WaStatus>("/api/whatsapp/status") });
  const conversations = useQuery({ queryKey: ["whatsapp", "conversations"], queryFn: () => api<Conversation[]>("/api/whatsapp/conversations") });
  const thread = useQuery({ queryKey: ["whatsapp", "thread", selected], queryFn: () => api<Thread>(`/api/whatsapp/conversations/${selected}`), enabled: !!selected });
  const leadId = thread.data?.conversation.lead?.id ?? pendingLead?.id ?? null;
  const drafts = useQuery({
    queryKey: ["whatsapp", "drafts", leadId],
    queryFn: () => api<{ id: string; body: string; createdAt: string }[]>(`/api/whatsapp/leads/${leadId}/drafts`),
    enabled: !!leadId,
  });

  // Vindo do CRM (?lead=…): abre a conversa existente ou prepara uma nova.
  useEffect(() => {
    if (!leadParam) return;
    void (async () => {
      const [{ conversation }, lead] = await Promise.all([
        api<{ conversation: { id: string } | null }>(`/api/whatsapp/leads/${leadParam}/conversation`),
        api<LeadLite>(`/api/crm/leads/${leadParam}`),
      ]).catch(() => [{ conversation: null }, null] as const);
      if (conversation) {
        setSelected(conversation.id);
        setPendingLead(null);
      } else if (lead) {
        setSelected(null);
        setPendingLead(lead);
      }
      setParams({}, { replace: true });
    })();
  }, [leadParam, setParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread.data?.messages.length]);

  useRealtime({
    "message:new": ({ conversationId }: { conversationId: string }) => {
      void qc.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
      if (conversationId === selected) void qc.invalidateQueries({ queryKey: ["whatsapp", "thread", selected] });
    },
    "message:updated": ({ conversationId }: { conversationId: string }) => {
      void qc.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
      void qc.invalidateQueries({ queryKey: ["whatsapp", "usage"] });
      if (conversationId === selected) void qc.invalidateQueries({ queryKey: ["whatsapp", "thread", selected] });
    },
    "whatsapp:status": () => void qc.invalidateQueries({ queryKey: ["whatsapp", "status"] }),
  });

  const send = useMutation({
    mutationFn: (legalBasis?: "LEGITIMATE_INTEREST" | "CONSENT") =>
      api<Msg>("/api/whatsapp/messages", { method: "POST", body: { leadId, body: text, idempotencyKey: keyRef.current, legalBasis } }),
    onSuccess: async (m) => {
      keyRef.current = crypto.randomUUID();
      setText("");
      setLegalPrompt(false);
      toast.success(m.sendAfter && new Date(m.sendAfter).getTime() - Date.now() > 5000 ? `Na fila: sai às ${new Date(m.sendAfter).toLocaleTimeString("pt-BR")}` : "Mensagem na fila de envio");
      if (!selected) {
        setSelected(m.conversationId);
        setPendingLead(null);
      }
      await qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "LEGAL_BASIS_REQUIRED") return setLegalPrompt(true);
      toast.error(e.message);
    },
  });

  // Mensagem gerada pelo backend (motor de templates do Writer), a partir dos dados do lead.
  const compose = useMutation({
    mutationFn: () => api<{ body: string }>("/api/whatsapp/compose", { method: "POST", body: { leadId, kind: composeKind } }),
    onSuccess: (r) => setText(r.body),
    onError: (e) => toast.error(e.message),
  });
  const saveTemplate = useMutation({
    mutationFn: (name: string) => api("/api/whatsapp/templates", { method: "POST", body: { name, body: text } }),
    onSuccess: () => { toast.success("Template salvo"); void qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }); },
    onError: (e) => toast.error(e.message),
  });
  const applyTemplate = (t: Template) => {
    const lead = thread.data?.conversation.lead ?? pendingLead;
    setText(t.body.replace(/\{empresa\}/gi, lead?.companyName ?? "{empresa}").replace(/\{cidade\}/gi, lead?.city ?? ""));
  };

  const pause = useMutation({
    mutationFn: (paused: boolean) => api(`/api/whatsapp/conversations/${selected}/pause`, { method: "POST", body: { paused } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
  const block = useMutation({
    mutationFn: () => api("/api/whatsapp/suppression", { method: "POST", body: { phone: thread.data!.conversation.contactPhone, reason: "Bloqueado manualmente na Central de Mensagens" } }),
    onSuccess: () => {
      toast.success("Contato bloqueado. Nenhuma mensagem será enviada.");
      void qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
  });
  const followUp = useMutation({
    mutationFn: (days: number) => api("/api/crm/tasks", { method: "POST", body: { leadId, title: "Follow-up no WhatsApp", type: "FOLLOW_UP", dueAt: new Date(Date.now() + days * 86_400_000).toISOString() } }),
    onSuccess: () => toast.success("Lembrete de follow-up criado"),
    onError: (e) => toast.error(e.message),
  });

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (conversations.data ?? []).filter((c) => !f || c.lead?.companyName.toLowerCase().includes(f) || c.contactPhone.includes(f));
  }, [conversations.data, filter]);

  const header = thread.data?.conversation.lead ?? pendingLead;
  const conv = thread.data?.conversation;
  const connected = wa.data?.status === "CONNECTED";
  const disabledReason = !connected ? "Conecte o WhatsApp para enviar." : conv?.blocked ? "Contato na lista de bloqueio." : conv?.sequencePaused ? "Sequência interrompida. Retome para enviar." : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Mensagens</h1>
          <p className="mt-1 text-sm text-muted">Uma conversa por vez, revisada por você. Envios entram numa fila que respeita os limites.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={connected ? "success" : "warning"}>{connected ? `WhatsApp ${wa.data?.phoneNumber ?? "conectado"}` : "WhatsApp desconectado"}</Badge>
          {!connected && <Button asChild size="sm" variant="secondary"><Link to="/whatsapp">Conectar</Link></Button>}
        </div>
      </div>

      <Card className="grid h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden md:grid-cols-[300px_1fr]">
        <aside className={cn("flex min-h-0 flex-col border-r", (selected || pendingLead) && "hidden md:flex")}>
          <div className="flex gap-2 border-b p-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar conversas…" className="h-9" aria-label="Filtrar conversas" />
            <Button size="icon" className="size-9 shrink-0" onClick={() => setPicker(true)} aria-label="Nova conversa"><MessageSquarePlus /></Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {conversations.isPending ? (
              <li className="space-y-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</li>
            ) : list.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted">Nenhuma conversa ainda.</li>
            ) : list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { setSelected(c.id); setPendingLead(null); }}
                  className={cn("flex w-full gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-surface-muted/60", selected === c.id && "bg-primary-soft")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{c.lead?.companyName ?? c.contactPhone}</span>
                      {c.lastMessageAt && <span className="shrink-0 text-[10px] font-normal text-muted">{formatRelative(c.lastMessageAt)}</span>}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                      {c.lastMessage?.direction === "OUTBOUND" && <StatusIcon m={c.lastMessage} />}
                      <span className="truncate">{c.lastMessage?.body ?? "Sem mensagens"}</span>
                    </p>
                  </div>
                  {c.unreadCount > 0 && <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">{c.unreadCount}</span>}
                  {c.sequencePaused && <Pause className="mt-1 size-3.5 shrink-0 text-warning" aria-label="Sequência interrompida" />}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={cn("flex min-h-0 flex-col", !(selected || pendingLead) && "hidden md:flex")}>
          {!header ? (
            <EmptyState icon={MessageSquarePlus} title="Selecione uma conversa" description="Ou comece uma nova a partir de um lead do CRM."
              action={<Button onClick={() => setPicker(true)}><MessageSquarePlus /> Nova conversa</Button>} className="m-auto" />
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                <button type="button" className="text-xs text-primary md:hidden" onClick={() => { setSelected(null); setPendingLead(null); }}>← Voltar</button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{header.companyName}</p>
                  <p className="text-xs text-muted">{[conv?.contactPhone ?? pendingLead?.phone, header.city, "stage" in header ? header.stage.name : null].filter(Boolean).join(" · ")}</p>
                </div>
                <Button asChild size="sm" variant="ghost"><Link to={`/crm?lead=${header.id}`}><ExternalLink /> Lead</Link></Button>
                {leadId && <Button size="sm" variant="ghost" onClick={() => followUp.mutate(3)}><CalendarPlus /> Follow-up 3d</Button>}
                {conv && !conv.blocked && (
                  <Button size="sm" variant="ghost" onClick={() => pause.mutate(!conv.sequencePaused)}>
                    {conv.sequencePaused ? <><Play /> Retomar</> : <><Pause /> Interromper</>}
                  </Button>
                )}
                {conv && !conv.blocked && <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => block.mutate()}><Ban /> Bloquear</Button>}
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-muted/40 p-4">
                {conv?.blocked && <p className="mx-auto flex max-w-md items-center gap-2 rounded-lg bg-danger/10 p-2 text-xs text-danger"><ShieldAlert className="size-4" /> Este contato está na lista de bloqueio.</p>}
                {thread.data?.messages.length === 0 || (!thread.data && pendingLead) ? (
                  <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem ainda. Seja breve, se apresente e diga por que está entrando em contato.</p>
                ) : thread.data?.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-xs", m.direction === "OUTBOUND" ? "rounded-br-sm bg-[#d9fdd3] text-slate-900 dark:bg-emerald-900/60 dark:text-emerald-50" : "rounded-bl-sm bg-surface")}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
                        {new Date(m.sentAt ?? m.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {m.direction === "OUTBOUND" && <StatusIcon m={m} />}
                      </p>
                      {m.status === "FAILED" && m.error && <p className="mt-1 text-[11px] text-danger">{m.error}</p>}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <footer className="space-y-2 border-t p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="h-8 rounded-lg border bg-surface px-2 text-xs" value={composeKind} onChange={(e) => setComposeKind(e.target.value as typeof composeKind)} aria-label="Tipo de mensagem">
                    {COMPOSE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                  <Button type="button" size="sm" variant="secondary" disabled={!leadId || !!conv?.blocked} loading={compose.isPending} onClick={() => compose.mutate()}><Wand2 /> Gerar mensagem</Button>
                  {templates.data && templates.data.length > 0 && (
                    <select className="h-8 rounded-lg border bg-surface px-2 text-xs" value="" onChange={(e) => { const t = templates.data!.find((x) => x.id === e.target.value); if (t) applyTemplate(t); }} aria-label="Usar template">
                      <option value="">Usar template…</option>
                      {templates.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  <Button type="button" size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { const name = window.prompt("Nome do template:"); if (name?.trim()) saveTemplate.mutate(name.trim()); }}><Bookmark /> Salvar como template</Button>
                </div>
                {drafts.data && drafts.data.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted"><FileText className="mr-1 inline size-3" />Rascunhos do Writer:</span>
                    {drafts.data.map((d, i) => (
                      <button key={d.id} type="button" onClick={() => setText(d.body)} className="max-w-56 truncate rounded-full border px-2.5 py-0.5 text-[11px] hover:border-primary hover:text-primary" title={d.body}>
                        Rascunho {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !disabledReason) send.mutate(undefined); }}>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1500} placeholder={conv?.blocked ? "Contato na lista de bloqueio." : "Escreva ou clique em Gerar mensagem… (Enter envia, Shift+Enter quebra linha)"}
                    disabled={!!conv?.blocked} aria-label="Mensagem"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                    className="max-h-40 min-h-11 flex-1 resize-y rounded-xl border bg-surface px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60" />
                  <Button type="submit" size="icon" className="size-11 shrink-0" disabled={!text.trim() || !!disabledReason} loading={send.isPending} aria-label="Enviar"><Send /></Button>
                </form>
                <p className="text-[11px] text-muted">{disabledReason ? <span className="font-medium text-warning">{disabledReason} </span> : null}{text.length}/1500 · revise antes de enviar. A mensagem entra na fila e sai respeitando o intervalo mínimo.</p>
              </footer>
            </>
          )}
        </section>
      </Card>

      <NewConversation open={picker} onOpenChange={setPicker} onPick={async (l) => {
        setPicker(false);
        const { conversation } = await api<{ conversation: { id: string } | null }>(`/api/whatsapp/leads/${l.id}/conversation`);
        if (conversation) { setSelected(conversation.id); setPendingLead(null); } else { setSelected(null); setPendingLead(l); }
      }} />

      <Dialog open={legalPrompt} onOpenChange={setLegalPrompt} title="Primeiro contato com esta empresa"
        description="Pela LGPD, a abordagem comercial precisa de uma base legal. Para contato B2B com dados públicos de empresas, normalmente é o legítimo interesse — desde que a mensagem seja relevante e você respeite quem pedir para sair.">
        <div className="space-y-2">
          <Button className="w-full" loading={send.isPending} onClick={() => send.mutate("LEGITIMATE_INTEREST")}>Confirmo: legítimo interesse (contato B2B relevante)</Button>
          <Button className="w-full" variant="secondary" loading={send.isPending} onClick={() => send.mutate("CONSENT")}>A empresa autorizou o contato</Button>
          <Button className="w-full" variant="ghost" onClick={() => setLegalPrompt(false)}>Cancelar</Button>
        </div>
      </Dialog>
    </div>
  );
}
