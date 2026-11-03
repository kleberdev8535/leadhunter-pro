import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { toast } from "sonner";
import {
  CalendarPlus,
  Check,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states";
import { ACTIVITY_LABEL, INTEREST_LABEL, whatsappLink, type FilterOptions, type Interest, type LeadDetail } from "./types";

const selectCls = "h-10 w-full rounded-lg border bg-surface px-3 text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

const QUICK_TASKS = [
  { label: "Amanhã", days: 1, title: "Entrar em contato" },
  { label: "Follow-up 3 dias", days: 3, title: "Follow-up" },
  { label: "Follow-up 7 dias", days: 7, title: "Follow-up" },
];

function useLeadMutations(leadId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["crm"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const opts = { onSuccess: refresh, onError: (e: Error) => toast.error(e.message) };
  return {
    update: useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/api/crm/leads/${leadId}`, { method: "PATCH", body }), ...opts }),
    note: useMutation({ mutationFn: (body: string) => api(`/api/crm/leads/${leadId}/notes`, { method: "POST", body: { body } }), ...opts }),
    delNote: useMutation({ mutationFn: (noteId: string) => api(`/api/crm/leads/${leadId}/notes/${noteId}`, { method: "DELETE" }), ...opts }),
    log: useMutation({ mutationFn: (type: string) => api(`/api/crm/leads/${leadId}/activities`, { method: "POST", body: { type } }), ...opts }),
    task: useMutation({ mutationFn: (body: Record<string, unknown>) => api("/api/crm/tasks", { method: "POST", body: { leadId, ...body } }), ...opts }),
    taskStatus: useMutation({ mutationFn: ({ id, ...body }: { id: string; status?: string; dueAt?: string }) => api(`/api/crm/tasks/${id}`, { method: "PATCH", body }), ...opts }),
    remove: useMutation({ mutationFn: () => api(`/api/crm/leads/${leadId}`, { method: "DELETE" }), ...opts }),
  };
}

function EditForm({ lead, options, onDone }: { lead: LeadDetail; options?: FilterOptions; onDone: () => void }) {
  const m = useLeadMutations(lead.id);
  const [f, setF] = useState({
    companyName: lead.companyName, contactName: lead.contactName ?? "", niche: lead.niche ?? "", city: lead.city ?? "",
    state: lead.state ?? "", address: lead.address ?? "", phone: lead.phone ?? "", email: lead.email ?? "", website: lead.website ?? "",
    ownerId: lead.owner?.id ?? "", interest: lead.interest,
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.update.mutate({ ...f, ownerId: f.ownerId || null }, { onSuccess: () => { toast.success("Lead atualizado"); onDone(); } });
      }}
    >
      <Field label="Empresa" htmlFor="e-company"><Input id="e-company" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contato" htmlFor="e-contact"><Input id="e-contact" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
        <Field label="Nicho" htmlFor="e-niche"><Input id="e-niche" value={f.niche} onChange={(e) => set("niche", e.target.value)} /></Field>
        <Field label="Telefone" htmlFor="e-phone"><Input id="e-phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email" htmlFor="e-email"><Input id="e-email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Cidade" htmlFor="e-city"><Input id="e-city" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Estado" htmlFor="e-state"><Input id="e-state" value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
      </div>
      <Field label="Endereço" htmlFor="e-addr"><Input id="e-addr" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      <Field label="Website" htmlFor="e-site"><Input id="e-site" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Responsável" htmlFor="e-owner">
          <select id="e-owner" className={selectCls} value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
            <option value="">Sem responsável</option>
            {options?.members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Interesse" htmlFor="e-int">
          <select id="e-int" className={selectCls} value={f.interest} onChange={(e) => set("interest", e.target.value as Interest)}>
            {(Object.keys(INTEREST_LABEL) as Interest[]).map((k) => <option key={k} value={k}>{INTEREST_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={m.update.isPending}>Salvar</Button>
      </div>
    </form>
  );
}

interface FieldDef { id: string; key: string; label: string; type: string; options: string[] }

function CustomFields({ lead }: { lead: LeadDetail }) {
  const qc = useQueryClient();
  const defs = useQuery({ queryKey: ["crm", "custom-fields"], queryFn: () => api<FieldDef[]>("/api/workspace/custom-fields") });
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(lead.customFields ?? {}) }));
  const save = useMutation({
    mutationFn: () => api(`/api/workspace/leads/${lead.id}/custom-fields`, { method: "PUT", body: { values } }),
    onSuccess: () => { toast.success("Campos salvos"); void qc.invalidateQueries({ queryKey: ["crm", "lead", lead.id] }); },
    onError: (e) => toast.error(e.message),
  });
  if (!defs.data?.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Campos personalizados</h3>
      <div className="grid grid-cols-2 gap-2">
        {defs.data.map((f) => {
          const v = values[f.key];
          const set = (x: unknown) => setValues((s) => ({ ...s, [f.key]: x }));
          return (
            <label key={f.id} className="space-y-1 text-xs">
              <span className="text-muted">{f.label}</span>
              {f.type === "BOOLEAN" ? (
                <input type="checkbox" className="block size-4 accent-[var(--primary)]" checked={v === true} onChange={(e) => set(e.target.checked)} />
              ) : f.type === "SELECT" ? (
                <select className={selectCls + " h-9"} value={(v as string) ?? ""} onChange={(e) => set(e.target.value || null)}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <Input className="h-9" type={f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"} value={(v as string | number | undefined) ?? ""} onChange={(e) => set(e.target.value)} />
              )}
            </label>
          );
        })}
      </div>
      <Button size="sm" variant="secondary" className="mt-2" loading={save.isPending} onClick={() => save.mutate()}>Salvar campos</Button>
    </section>
  );
}

function TagPicker({ lead, options }: { lead: LeadDetail; options?: FilterOptions }) {
  const qc = useQueryClient();
  const m = useLeadMutations(lead.id);
  const [name, setName] = useState("");
  const selected = new Set(lead.tags.map((t) => t.id));
  const toggle = (id: string) => {
    const next = selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id];
    m.update.mutate({ tagIds: next });
  };
  const create = useMutation({
    mutationFn: () => api<{ id: string }>("/api/crm/tags", { method: "POST", body: { name: name.trim(), color: ["#8B5CF6", "#EF4444", "#F59E0B", "#22C55E", "#0EA5E9"][name.length % 5] } }),
    onSuccess: (tag) => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["crm", "filters"] });
      m.update.mutate({ tagIds: [...selected, tag.id] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options?.tags.map((t) => (
        <button key={t.id} type="button" onClick={() => toggle(t.id)} aria-pressed={selected.has(t.id)}
          className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity", !selected.has(t.id) && "opacity-40 hover:opacity-80")}
          style={{ borderColor: t.color, color: t.color, background: selected.has(t.id) ? `${t.color}1a` : undefined }}>
          {t.name}
        </button>
      ))}
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova etiqueta" maxLength={40} aria-label="Nova etiqueta"
          className="h-6 w-28 rounded-full border bg-transparent px-2 text-[11px] focus:border-primary focus:outline-none" />
      </form>
    </div>
  );
}

export function LeadDrawer({ leadId, onClose, options }: { leadId: string | null; onClose: () => void; options?: FilterOptions }) {
  const q = useQuery({ queryKey: ["crm", "lead", leadId], queryFn: () => api<LeadDetail>(`/api/crm/leads/${leadId}`), enabled: !!leadId });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const lead = q.data;
  const m = useLeadMutations(leadId ?? "");
  useEffect(() => setEditing(false), [leadId]);

  const addTask = (title: string, days?: number) => {
    const due = days !== undefined ? new Date(Date.now() + days * 86_400_000) : new Date(taskDue);
    if (Number.isNaN(due.getTime())) return toast.error("Informe a data");
    if (days === undefined) due.setHours(9, 0, 0, 0);
    m.task.mutate({ title, dueAt: due.toISOString(), type: "FOLLOW_UP" }, { onSuccess: () => { toast.success("Tarefa criada"); setTaskTitle(""); setTaskDue(""); } });
  };

  const wa = whatsappLink(lead?.phoneE164 ?? null);

  return (
    <D.Root open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-surface shadow-2xl data-[state=open]:animate-[slide-in_0.2s_ease-out]">
          <div className="flex items-start gap-3 border-b p-5">
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-lg font-semibold">{lead?.companyName ?? "Lead"}</D.Title>
              <D.Description className="text-xs text-muted">
                {lead ? `${lead.stage.name} · criado ${formatDateTime(lead.createdAt)} · ${lead.source?.label ?? "Origem desconhecida"}` : "Carregando…"}
              </D.Description>
            </div>
            {lead && !editing && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label="Editar lead"><Pencil /></Button>
            )}
            <D.Close asChild><Button variant="ghost" size="icon" aria-label="Fechar"><X /></Button></D.Close>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            {q.isPending ? (
              <Skeleton className="h-60" />
            ) : q.isError ? (
              <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
            ) : lead && editing ? (
              <EditForm lead={lead} options={options} onDone={() => setEditing(false)} />
            ) : lead ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {lead.phoneE164 && (
                    <Button asChild size="sm"><Link to={`/mensagens?lead=${lead.id}`}><Send /> Enviar mensagem</Link></Button>
                  )}
                  {wa && (
                    <Button asChild size="sm" className="bg-[#25D366] text-white shadow-none hover:bg-[#1ebe5b]">
                      <a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> Abrir no WhatsApp</a>
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => m.log.mutate("MESSAGE_SENT", { onSuccess: () => toast.success("Contato registrado") })}>Registrar contato</Button>
                  <Button size="sm" variant="secondary" onClick={() => m.log.mutate("REPLY_RECEIVED", { onSuccess: () => toast.success("Resposta registrada") })}>Registrar resposta</Button>
                  <Button size="sm" variant="secondary" onClick={() => m.log.mutate("INTEREST_SHOWN", { onSuccess: () => toast.success("Interesse registrado") })}>Demonstrou interesse</Button>
                </div>

                <dl className="grid grid-cols-1 gap-2 text-sm">
                  {[
                    [Phone, lead.phone],
                    [Mail, lead.email],
                    [MapPin, [lead.address, lead.city, lead.state].filter(Boolean).join(" · ") || null],
                  ].map(([Icon, v], i) => {
                    const I = Icon as typeof Phone;
                    return (
                      <div key={i} className="flex items-center gap-2.5">
                        <I className="size-4 shrink-0 text-muted" />
                        <dd className={cn(!v && "text-muted")}>{(v as string) || "Não informado"}</dd>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2.5">
                    <Globe className="size-4 shrink-0 text-muted" />
                    {lead.website ? (
                      <a href={lead.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{lead.website}</a>
                    ) : (
                      <span className="text-muted">{lead.placeId ? "Nenhum site informado no Google" : "Não informado"}</span>
                    )}
                  </div>
                  {lead.googleMapsUrl && (
                    <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Ver no Google Maps <ExternalLink className="size-3" />
                    </a>
                  )}
                </dl>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Score</p><p className="text-lg font-semibold">{lead.score}</p></div>
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Interesse</p><p className="text-sm font-semibold">{INTEREST_LABEL[lead.interest]}</p></div>
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Responsável</p><p className="truncate text-sm font-semibold">{lead.owner?.name ?? "—"}</p></div>
                </div>
                {lead.scoreReasons.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted">
                    {lead.scoreReasons.map((r) => <li key={r.reason}><span className="font-medium text-success">+{r.points}</span> {r.reason}</li>)}
                  </ul>
                )}

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Etiquetas</h3>
                  <TagPicker lead={lead} options={options} />
                </section>

                <CustomFields key={lead.id} lead={lead} />

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Tarefas</h3>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {QUICK_TASKS.map((t) => (
                      <button key={t.label} type="button" onClick={() => addTask(t.title, t.days)} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">
                        <CalendarPlus className="mr-1 inline size-3" />{t.label}
                      </button>
                    ))}
                  </div>
                  <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (taskTitle.trim() && taskDue) addTask(taskTitle.trim()); }}>
                    <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Nova tarefa" aria-label="Título da tarefa" className="h-9" />
                    <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} aria-label="Data" className="h-9 w-36" />
                    <Button type="submit" size="icon" className="size-9 shrink-0" aria-label="Adicionar tarefa" disabled={!taskTitle.trim() || !taskDue}><Plus /></Button>
                  </form>
                  <ul className="space-y-1.5">
                    {lead.tasks.map((t) => {
                      const late = t.status === "PENDING" && new Date(t.dueAt) < new Date();
                      return (
                        <li key={t.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                          <button type="button" disabled={t.status !== "PENDING"} onClick={() => m.taskStatus.mutate({ id: t.id, status: "DONE" })}
                            aria-label="Concluir tarefa"
                            className={cn("flex size-4 shrink-0 items-center justify-center rounded border", t.status === "DONE" && "border-success bg-success text-white")}>
                            {t.status === "DONE" && <Check className="size-3" />}
                          </button>
                          <span className={cn("flex-1", t.status !== "PENDING" && "text-muted line-through")}>{t.title}</span>
                          <span className={cn("text-xs", late ? "font-medium text-danger" : "text-muted")}>{new Date(t.dueAt).toLocaleDateString("pt-BR")}</span>
                          {t.status === "PENDING" && (
                            <>
                              <button type="button" className="text-[11px] text-muted hover:text-foreground" onClick={() => m.taskStatus.mutate({ id: t.id, dueAt: new Date(new Date(t.dueAt).getTime() + 86_400_000).toISOString() })}>+1 dia</button>
                              <button type="button" className="text-[11px] text-muted hover:text-danger" onClick={() => m.taskStatus.mutate({ id: t.id, status: "CANCELED" })}>Cancelar</button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Notas</h3>
                  <form className="mb-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) m.note.mutate(note.trim(), { onSuccess: () => setNote("") }); }}>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000} placeholder="Escreva uma observação…" aria-label="Nova nota"
                      className="w-full rounded-lg border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15" />
                    <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} loading={m.note.isPending}><StickyNote /> Adicionar nota</Button>
                  </form>
                  <ul className="space-y-2">
                    {lead.notes.map((n) => (
                      <li key={n.id} className="group rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
                        <p className="whitespace-pre-wrap">{n.body}</p>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                          <span>{n.author?.name} · {formatRelative(n.createdAt)}</span>
                          <button type="button" className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100" onClick={() => m.delNote.mutate(n.id)} aria-label="Excluir nota"><Trash2 className="size-3.5" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Histórico de atividades</h3>
                  <ol className="relative space-y-3 border-l pl-4">
                    {lead.activities.map((a) => (
                      <li key={a.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-surface" />
                        <p><span className="font-medium">{ACTIVITY_LABEL[a.type] ?? a.type}</span>{a.description && ACTIVITY_LABEL[a.type] !== a.description && <span className="text-muted"> · {a.description}</span>}</p>
                        <p className="text-[11px] text-muted">{formatDateTime(a.createdAt)}{a.actor && ` · ${a.actor.name}`}</p>
                      </li>
                    ))}
                  </ol>
                </section>

                <div className="border-t pt-4">
                  <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setConfirmDelete(true)}><Trash2 /> Excluir lead</Button>
                </div>
              </>
            ) : null}
          </div>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Excluir este lead?"
            description={`"${lead?.companyName}" sai do CRM. O histórico continua guardado para auditoria.`}
            confirmLabel="Excluir"
            destructive
            loading={m.remove.isPending}
            onConfirm={() => m.remove.mutate(undefined, { onSuccess: () => { toast.success("Lead excluído"); setConfirmDelete(false); onClose(); } })}
          />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
