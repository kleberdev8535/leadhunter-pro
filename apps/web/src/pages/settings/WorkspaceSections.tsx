import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Smartphone, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import type { FilterOptions, Stage } from "../crm/types";

const selectCls = "h-10 w-full rounded-lg border bg-surface px-3 text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

function StageRow({ stage }: { stage: Stage }) {
  const qc = useQueryClient();
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const save = useMutation({
    mutationFn: () => api(`/api/workspace/stages/${stage.id}`, { method: "PATCH", body: { name, color } }),
    onSuccess: () => { toast.success("Etapa atualizada"); void qc.invalidateQueries({ queryKey: ["crm"] }); },
    onError: (e) => toast.error(e.message),
  });
  const dirty = name !== stage.name || color.toLowerCase() !== stage.color.toLowerCase();
  return (
    <li className="flex items-center gap-2 py-2">
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={`Cor de ${stage.name}`} className="size-8 shrink-0 cursor-pointer rounded border bg-transparent" />
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" aria-label="Nome da etapa" maxLength={60} />
      <Badge className="shrink-0">{stage.kind === "WON" ? "Ganho" : stage.kind === "LOST" ? "Perda" : "Aberta"}</Badge>
      <Button size="sm" variant="secondary" disabled={!dirty || name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
    </li>
  );
}

export function CrmSettingsSection() {
  const qc = useQueryClient();
  const pipeline = useQuery({ queryKey: ["crm", "pipeline"], queryFn: () => api<{ stages: Stage[] }>("/api/crm/pipeline") });
  const options = useQuery({ queryKey: ["crm", "filters"], queryFn: () => api<FilterOptions>("/api/crm/filters") });
  const fields = useQuery({ queryKey: ["crm", "custom-fields"], queryFn: () => api<{ id: string; key: string; label: string; type: string; options: string[] }[]>("/api/workspace/custom-fields") });
  const [tagName, setTagName] = useState("");
  const [field, setField] = useState({ label: "", type: "TEXT", options: "" });

  const addTag = useMutation({
    mutationFn: () => api("/api/crm/tags", { method: "POST", body: { name: tagName.trim() } }),
    onSuccess: () => { setTagName(""); void qc.invalidateQueries({ queryKey: ["crm", "filters"] }); },
    onError: (e) => toast.error(e.message),
  });
  const delTag = useMutation({
    mutationFn: (id: string) => api(`/api/workspace/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["crm"] }),
  });
  const addField = useMutation({
    mutationFn: () => api("/api/workspace/custom-fields", { method: "POST", body: { label: field.label.trim(), type: field.type, options: field.options.split(",").map((s) => s.trim()).filter(Boolean) } }),
    onSuccess: () => { setField({ label: "", type: "TEXT", options: "" }); void qc.invalidateQueries({ queryKey: ["crm", "custom-fields"] }); },
    onError: (e) => toast.error(e.message),
  });
  const delField = useMutation({
    mutationFn: (id: string) => api(`/api/workspace/custom-fields/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["crm", "custom-fields"] }),
  });

  return (
    <>
      <Card>
        <CardHeader><div><CardTitle>Etapas do Kanban</CardTitle><CardDescription>Renomeie e mude cores. A ordem e o tipo (aberta, ganho, perda) são fixos para os relatórios continuarem corretos.</CardDescription></div></CardHeader>
        <CardContent>{pipeline.data ? <ul className="divide-y">{pipeline.data.stages.map((s) => <StageRow key={s.id} stage={s} />)}</ul> : <Skeleton className="h-60" />}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Etiquetas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {options.data?.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: t.color, color: t.color }}>
                {t.name}
                <button type="button" onClick={() => delTag.mutate(t.id)} aria-label={`Excluir ${t.name}`} className="opacity-60 hover:opacity-100"><Trash2 className="size-3" /></button>
              </span>
            ))}
            {!options.data?.tags.length && <p className="text-sm text-muted">Nenhuma etiqueta.</p>}
          </div>
          <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); if (tagName.trim()) addTag.mutate(); }}>
            <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="Nova etiqueta" maxLength={40} className="h-9" aria-label="Nova etiqueta" />
            <Button type="submit" size="sm" disabled={!tagName.trim()}><Plus /> Criar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div><CardTitle>Campos personalizados</CardTitle><CardDescription>Aparecem no painel de cada lead.</CardDescription></div></CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y text-sm">
            {fields.data?.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 font-medium">{f.label}</span>
                <Badge>{({ TEXT: "Texto", NUMBER: "Número", DATE: "Data", BOOLEAN: "Sim/Não", SELECT: "Lista" } as Record<string, string>)[f.type]}</Badge>
                {f.type === "SELECT" && <span className="text-xs text-muted">{f.options.join(", ")}</span>}
                <button type="button" onClick={() => delField.mutate(f.id)} className="text-muted hover:text-danger" aria-label={`Excluir ${f.label}`}><Trash2 className="size-4" /></button>
              </li>
            ))}
            {!fields.data?.length && <li className="py-2 text-muted">Nenhum campo personalizado.</li>}
          </ul>
          <form className="grid gap-2 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (field.label.trim().length >= 2) addField.mutate(); }}>
            <Field label="Nome do campo" htmlFor="cf-label"><Input id="cf-label" value={field.label} onChange={(e) => setField({ ...field, label: e.target.value })} placeholder="ex.: Instagram" /></Field>
            <Field label="Tipo" htmlFor="cf-type">
              <select id="cf-type" className={selectCls} value={field.type} onChange={(e) => setField({ ...field, type: e.target.value })}>
                <option value="TEXT">Texto</option><option value="NUMBER">Número</option><option value="DATE">Data</option><option value="BOOLEAN">Sim/Não</option><option value="SELECT">Lista</option>
              </select>
            </Field>
            <Field label="Opções (lista, separadas por vírgula)" htmlFor="cf-opt"><Input id="cf-opt" value={field.options} disabled={field.type !== "SELECT"} onChange={(e) => setField({ ...field, options: e.target.value })} /></Field>
            <Button type="submit" disabled={field.label.trim().length < 2} loading={addField.isPending}><Plus /> Adicionar</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

export function WhatsAppSettingsSection() {
  return (
    <Card>
      <CardHeader><div><CardTitle>WhatsApp</CardTitle><CardDescription>Conexão por QR Code, status, logs e lista de bloqueio ficam na página do WhatsApp. Limites de envio ficam em Prospecção.</CardDescription></div></CardHeader>
      <CardContent><Button asChild><Link to="/whatsapp"><Smartphone /> Abrir WhatsApp</Link></Button></CardContent>
    </Card>
  );
}

interface AuditRow { id: string; action: string; entity: string | null; entityId: string | null; ip: string | null; createdAt: string; metadata: unknown; user: { name: string; email: string } | null }

export function AuditSection() {
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["audit", filter], queryFn: () => api<AuditRow[]>(`/api/workspace/audit?limit=200${filter ? `&action=${filter}` : ""}`) });
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>Logs de auditoria</CardTitle><CardDescription>Ações sensíveis da organização (somente dono e administradores).</CardDescription></div>
        <select className="h-9 rounded-lg border bg-surface px-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar ações">
          <option value="">Todas</option><option value="auth.">Acessos</option><option value="lead.">Leads</option><option value="whatsapp.">WhatsApp</option><option value="task.">Agentes</option><option value="integration.">Integrações</option><option value="settings.">Configurações</option>
        </select>
      </CardHeader>
      <CardContent>
        {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <p className="text-sm text-muted">{q.error.message}</p> : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-surface"><tr className="text-left text-muted"><th className="pb-2 font-medium">Quando</th><th className="pb-2 font-medium">Quem</th><th className="pb-2 font-medium">Ação</th><th className="pb-2 font-medium">IP</th></tr></thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1.5 tabular-nums text-muted">{formatDateTime(a.createdAt)}</td>
                    <td className="py-1.5">{a.user?.name ?? "—"}</td>
                    <td className="py-1.5 font-mono">{a.action}</td>
                    <td className="py-1.5 tabular-nums text-muted">{a.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
