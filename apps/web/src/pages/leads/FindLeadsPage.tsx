import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Info, Loader2, MapPin, Plus, Search, Star } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/states";
import type { Task } from "@/office/types";

interface SearchRow {
  id: string;
  placeId: string;
  name: string;
  niche: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUrl: string | null;
  lead: { id: string; score: number; stage: string } | null;
}
interface ResultsPage {
  job: { id: string; status: string; foundCount: number; requestCount: number; createdAt: string };
  total: number;
  page: number;
  pageSize: number;
  rows: SearchRow[];
}
interface SearchJob {
  id: string;
  status: string;
  params: { niches?: string[]; city?: string; state?: string; quantity?: number; website?: string };
  foundCount: number;
  createdAt: string;
}

const QUANTITIES = [10, 25, 50, 100, 250];
const selectCls = "h-10 w-full rounded-lg border bg-surface px-3 text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

export function FindLeadsPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["office", "catalog"], queryFn: () => api<{ niches: { key: string; label: string }[]; limits: { maxResultsPerQuery: number } }>("/api/office/catalog"), staleTime: Infinity });
  const google = useQuery({ queryKey: ["integrations", "google"], queryFn: () => api<{ status: string }>("/api/integrations/google-places") });
  const searches = useQuery({ queryKey: ["crm", "searches"], queryFn: () => api<SearchJob[]>("/api/crm/searches") });

  const [f, setF] = useState({
    niches: ["barbearias"] as string[], customNiche: "", country: "Brasil", state: "SP", city: "", neighborhood: "", quantity: 50,
    website: "any", requirePhone: false, minRating: "", minReviews: "", onlyNotInCrm: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [taskId, setTaskId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ ids: string[]; toAdd: number; alreadyInCrm: string[] } | null>(null);

  // Acompanha a tarefa do Hunter até terminar (consulta leve a cada 2s só enquanto roda).
  const task = useQuery({
    queryKey: ["office", "task", taskId],
    queryFn: () => api<Task>(`/api/office/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) => (q.state.data && ["COMPLETED", "FAILED", "CANCELLED"].includes(q.state.data.status) ? false : 2000),
  });
  useEffect(() => {
    const t = task.data;
    if (!t) return;
    const job = (t.result as { searchJobId?: string } | null)?.searchJobId;
    if (t.status === "COMPLETED" && job) {
      setJobId(job);
      setPage(1);
      void qc.invalidateQueries({ queryKey: ["crm", "searches"] });
    }
  }, [task.data, qc]);
  useEffect(() => {
    if (!jobId && searches.data?.[0]) setJobId(searches.data[0].id);
  }, [searches.data, jobId]);

  const results = useQuery({
    queryKey: ["crm", "results", jobId, page],
    queryFn: () => api<ResultsPage>(`/api/crm/searches/${jobId}/results?page=${page}&pageSize=50`),
    enabled: !!jobId,
    placeholderData: (p) => p,
  });

  const start = useMutation({
    mutationFn: () =>
      api<Task>("/api/office/tasks", {
        method: "POST",
        body: {
          taskType: "SEARCH_LEADS",
          idempotencyKey: crypto.randomUUID(),
          parameters: {
            niches: f.niches, customNiche: f.customNiche.trim() || undefined, country: f.country, state: f.state.trim(), city: f.city.trim(),
            neighborhood: f.neighborhood.trim() || undefined, quantity: f.quantity, website: f.website, requirePhone: f.requirePhone,
            minRating: f.minRating ? Number(f.minRating) : undefined, minReviews: f.minReviews ? Number(f.minReviews) : undefined, onlyNotInCrm: f.onlyNotInCrm,
          },
        },
      }),
    onSuccess: (t) => {
      setTaskId(t.id);
      toast.success("Busca enviada ao Hunter");
    },
    onError: (e) => toast.error(e instanceof ApiError && e.details?.length ? e.details.map((d) => d.message).join(" · ") : e.message),
  });

  const doImport = useMutation({
    mutationFn: (ids: string[]) => api<{ created: number; duplicates: number }>("/api/crm/import", { method: "POST", body: { resultIds: ids } }),
    onSuccess: (r) => {
      toast.success(`${r.created} lead(s) adicionados ao CRM${r.duplicates ? ` · ${r.duplicates} já existiam` : ""}`);
      setSelected(new Set());
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["crm"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const askImport = async (ids: string[]) => {
    try {
      const p = await api<{ toAdd: number; alreadyInCrm: string[] }>("/api/crm/import/preview", { method: "POST", body: { resultIds: ids } });
      setPreview({ ids, ...p });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const running = task.data && ["QUEUED", "RUNNING"].includes(task.data.status);
  const rows = results.data?.rows ?? [];
  const selectable = rows.filter((r) => !r.lead);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const pages = results.data ? Math.ceil(results.data.total / results.data.pageSize) : 1;
  const canSearch = f.city.trim() && f.state.trim() && f.niches.length > 0 && f.quantity >= 1 && f.quantity <= 250;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Encontrar Leads</h1>
        <p className="mt-1 text-sm text-muted">Busca real no Google Maps feita pelo Hunter. Revise os resultados e adicione ao CRM o que fizer sentido.</p>
      </div>

      {google.data && google.data.status !== "VALID" && (
        <Card className="flex items-center gap-3 border-warning/40 bg-warning/5 p-4 text-sm">
          <Info className="size-5 shrink-0 text-warning" />
          <p className="flex-1">A chave do Google Maps {google.data.status === "NOT_CONFIGURED" ? "não está configurada" : "ainda não foi validada"}.</p>
          <Button asChild size="sm" variant="secondary"><Link to="/configuracoes">Configurar</Link></Button>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Nova busca</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Nichos <span className="text-xs font-normal text-muted">(até 5)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {catalog.data?.niches.map((n) => {
                const on = f.niches.includes(n.key);
                return (
                  <button key={n.key} type="button" aria-pressed={on}
                    onClick={() => set("niches", on ? f.niches.filter((k) => k !== n.key) : f.niches.length < 5 ? [...f.niches, n.key] : f.niches)}
                    className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary-soft text-primary" : "hover:border-primary/50")}>
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="País" htmlFor="fl-country"><Input id="fl-country" value={f.country} onChange={(e) => set("country", e.target.value)} /></Field>
            <Field label="Estado" htmlFor="fl-state"><Input id="fl-state" value={f.state} onChange={(e) => set("state", e.target.value)} /></Field>
            <Field label="Cidade" htmlFor="fl-city"><Input id="fl-city" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Osasco" /></Field>
            <Field label="Bairro" htmlFor="fl-nb"><Input id="fl-nb" value={f.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} placeholder="opcional" /></Field>
            <Field label="Outro nicho" htmlFor="fl-cn"><Input id="fl-cn" value={f.customNiche} onChange={(e) => set("customNiche", e.target.value)} placeholder="opcional" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Quantidade" htmlFor="fl-q">
              <div className="flex gap-1">
                {QUANTITIES.map((q) => (
                  <button key={q} type="button" onClick={() => set("quantity", q)} className={cn("h-10 flex-1 rounded-lg border text-xs", f.quantity === q && "border-primary bg-primary-soft text-primary")}>{q}</button>
                ))}
                <Input id="fl-q" type="number" min={1} max={250} value={f.quantity} onChange={(e) => set("quantity", Number(e.target.value))} className="w-20" aria-label="Quantidade personalizada" />
              </div>
            </Field>
            <Field label="Site" htmlFor="fl-site">
              <select id="fl-site" className={selectCls} value={f.website} onChange={(e) => set("website", e.target.value)}>
                <option value="any">Qualquer</option>
                <option value="without">Sem site informado no Google</option>
                <option value="with">Com site</option>
              </select>
            </Field>
            <Field label="Avaliação mínima" htmlFor="fl-r"><Input id="fl-r" type="number" step="0.1" min={0} max={5} value={f.minRating} onChange={(e) => set("minRating", e.target.value)} /></Field>
            <Field label="Mín. de avaliações" htmlFor="fl-rv"><Input id="fl-rv" type="number" min={0} value={f.minReviews} onChange={(e) => set("minReviews", e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.requirePhone} onChange={(e) => set("requirePhone", e.target.checked)} /> Só com telefone</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={f.onlyNotInCrm} onChange={(e) => set("onlyNotInCrm", e.target.checked)} /> Só empresas ainda não cadastradas</label>
            <Button className="ml-auto" onClick={() => start.mutate()} disabled={!canSearch || !!running} loading={start.isPending || !!running}>
              <Search /> {running ? "Buscando…" : "Buscar"}
            </Button>
          </div>
          <p className="flex gap-2 text-xs text-muted">
            <Info className="size-4 shrink-0" />
            O Google devolve no máximo {catalog.data?.limits.maxResultsPerQuery ?? 60} lugares por nicho e região — para mais resultados, busque por bairro.
            "Sem site" significa que o Google não informou um site, não que a empresa não tenha. A busca por raio não está disponível: a Text Search usa cidade/bairro.
          </p>
          {task.data && (
            <div className="rounded-xl border p-3 text-sm">
              <div className="flex items-center gap-2">
                {running && <Loader2 className="size-4 animate-spin text-primary" />}
                <span className="font-medium">{task.data.title}</span>
                <Badge tone={task.data.status === "COMPLETED" ? "success" : task.data.status === "FAILED" ? "danger" : "primary"}>{task.data.status === "COMPLETED" ? "Concluída" : task.data.status === "FAILED" ? "Falhou" : "Em andamento"}</Badge>
              </div>
              {running && <div className="mt-2 h-1.5 rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${task.data.progress}%` }} /></div>}
              {task.data.errorMessage && <p className="mt-2 text-xs text-danger">{task.data.errorMessage}</p>}
              {task.data.result && <p className="mt-2 text-xs text-muted">{String((task.data.result as { note?: string }).note ?? "")}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-wrap">
          <div className="flex items-center gap-3">
            <CardTitle>Resultados</CardTitle>
            {searches.data && searches.data.length > 0 && (
              <select className="h-9 rounded-lg border bg-surface px-2 text-xs" value={jobId ?? ""} onChange={(e) => { setJobId(e.target.value); setPage(1); setSelected(new Set()); }} aria-label="Busca">
                {searches.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateTime(s.createdAt)} · {s.params.city ?? ""} · {s.foundCount} lugares
                  </option>
                ))}
              </select>
            )}
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={() => void askImport([...selected])}><Plus /> Adicionar {selected.size} selecionado(s) ao CRM</Button>
          )}
        </CardHeader>
        <CardContent>
          {!jobId ? (
            <EmptyState icon={MapPin} title="Nenhuma busca ainda" description="Escolha nicho e cidade e clique em Buscar. Os resultados aparecem aqui." />
          ) : results.isPending ? (
            <Skeleton className="h-64" />
          ) : results.isError ? (
            <ErrorState message={results.error.message} onRetry={() => void results.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title="Sem resultados" description="O Google não retornou lugares para esses filtros. Tente outro bairro ou nicho." />
          ) : (
            <>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted">
                      <th className="w-10 px-5 pb-2"><input type="checkbox" aria-label="Selecionar todos" className="size-4 accent-[var(--primary)]" checked={allSelected}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())} /></th>
                      <th className="pb-2 font-medium">Empresa</th>
                      <th className="pb-2 font-medium">Categoria</th>
                      <th className="pb-2 font-medium">Cidade / Endereço</th>
                      <th className="pb-2 font-medium">Telefone</th>
                      <th className="pb-2 font-medium">Website</th>
                      <th className="pb-2 font-medium">Avaliação</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="px-5 pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-surface-muted/50">
                        <td className="px-5 py-2.5">
                          <input type="checkbox" className="size-4 accent-[var(--primary)]" disabled={!!r.lead} aria-label={`Selecionar ${r.name}`} checked={selected.has(r.id)}
                            onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                        </td>
                        <td className="py-2.5 font-medium">
                          {r.name}
                          {r.googleMapsUrl && <a href={r.googleMapsUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex text-primary" aria-label="Abrir no Google Maps"><ExternalLink className="size-3.5" /></a>}
                        </td>
                        <td className="py-2.5 text-muted">{r.category ?? r.niche ?? "—"}</td>
                        <td className="max-w-56 py-2.5"><p>{r.city ?? "—"}</p><p className="truncate text-xs text-muted">{r.address}</p></td>
                        <td className="py-2.5 tabular-nums">{r.phone ?? <span className="text-muted">—</span>}</td>
                        <td className="max-w-40 py-2.5">{r.website ? <a href={r.website} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">{r.website.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="text-xs text-muted">Não informado</span>}</td>
                        <td className="py-2.5">{r.rating ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)} <span className="text-xs text-muted">({r.reviewCount})</span></span> : "—"}</td>
                        <td className="py-2.5">{r.lead ? <Badge tone="success">No CRM · {r.lead.stage}</Badge> : <Badge>Novo</Badge>}</td>
                        <td className="px-5 py-2.5 text-right">
                          {r.lead ? (
                            <Link to={`/crm?lead=${r.lead.id}`} className="text-xs text-primary hover:underline">Ver lead</Link>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => void askImport([r.id])}>Adicionar ao CRM</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span>Dados: Google Maps · {results.data?.total} lugar(es)</span>
                {pages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                    <span>{page} / {pages}</span>
                    <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title="Adicionar ao CRM?"
        description={
          preview ? (
            <>
              <strong>{preview.toAdd}</strong> lead(s) serão adicionados.
              {preview.alreadyInCrm.length > 0 && <> <strong>{preview.alreadyInCrm.length}</strong> já existem e serão ignorados ({preview.alreadyInCrm.slice(0, 3).join(", ")}{preview.alreadyInCrm.length > 3 ? "…" : ""}).</>}
            </>
          ) : ""
        }
        confirmLabel={`Adicionar ${preview?.toAdd ?? 0}`}
        loading={doImport.isPending}
        onConfirm={() => preview && doImport.mutate(preview.ids)}
      />
    </div>
  );
}
