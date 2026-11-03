import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, KeyRound, PlugZap, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states";

interface PlacesStatus {
  configured: boolean;
  status: "NOT_CONFIGURED" | "CONFIGURED" | "VALID" | "INVALID";
  credentialHint: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  usage: {
    today: { requests: number; places: number };
    month: { requests: number; places: number; estimatedCostUsd: number };
    limits: { dailyPlaces: number; monthlyRequests: number };
  };
}

const STATUS_META = {
  NOT_CONFIGURED: { label: "Não configurado", tone: "neutral" },
  CONFIGURED: { label: "Salva, não testada", tone: "warning" },
  VALID: { label: "Conectado", tone: "success" },
  INVALID: { label: "Chave recusada", tone: "danger" },
} as const;

export function GoogleMapsSection() {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = useQuery({ queryKey: ["integrations", "google"], queryFn: () => api<PlacesStatus>("/api/integrations/google-places") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["integrations", "google"] });

  const save = useMutation({
    mutationFn: () => api<PlacesStatus>("/api/integrations/google-places", { method: "PUT", body: { apiKey: apiKey.trim() } }),
    onSuccess: () => {
      setApiKey("");
      toast.success("Chave salva com criptografia. Teste a conexão.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; error?: string }>("/api/integrations/google-places/test", { method: "POST" }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Conexão com a Places API (New) funcionando");
      else toast.error(r.error ?? "Falha no teste");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api("/api/integrations/google-places", { method: "DELETE" }),
    onSuccess: () => {
      setConfirmRemove(false);
      toast.success("Chave removida");
      refresh();
    },
  });

  const s = status.data;
  const meta = s ? STATUS_META[s.status] : null;
  const pct = (v: number, max: number) => Math.min(100, Math.round((v / Math.max(1, max)) * 100));

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Google Maps — Places API (New)</CardTitle>
            <CardDescription>Usada pelo Hunter para buscar empresas. A chave fica criptografada no servidor e nunca volta para o navegador.</CardDescription>
          </div>
          {meta && <Badge tone={meta.tone}>{meta.label}</Badge>}
        </CardHeader>
        <CardContent className="space-y-5">
          {status.isPending ? (
            <Skeleton className="h-24" />
          ) : status.isError ? (
            <ErrorState message={status.error.message} onRetry={() => void status.refetch()} />
          ) : (
            <>
              {s?.configured && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
                  <KeyRound className="size-4 text-muted" />
                  <span>Chave salva <span className="font-mono">{s.credentialHint}</span></span>
                  {s.lastCheckedAt && <span className="text-xs text-muted">testada {formatDateTime(s.lastCheckedAt)}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}><PlugZap /> Testar integração</Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setConfirmRemove(true)} aria-label="Remover chave"><Trash2 /></Button>
                  </div>
                </div>
              )}
              {s?.lastError && (
                <p className="flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger"><XCircle className="size-4 shrink-0" />{s.lastError}</p>
              )}
              {s?.status === "VALID" && (
                <p className="flex items-center gap-2 text-xs text-success"><CheckCircle2 className="size-4" /> Pronta para o Hunter usar.</p>
              )}
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (apiKey.trim().length >= 20) save.mutate();
                }}
              >
                <div className="flex-1">
                  <Field label={s?.configured ? "Substituir chave" : "API Key"} htmlFor="gkey">
                    <Input id="gkey" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" />
                  </Field>
                </div>
                <Button type="submit" loading={save.isPending} disabled={apiKey.trim().length < 20}>Salvar chave</Button>
              </form>
              <a href="https://developers.google.com/maps/documentation/places/web-service/get-api-key" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Como criar a chave e ativar a Places API (New) <ExternalLink className="size-3" />
              </a>

              {s && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Lugares hoje", s.usage.today.places, s.usage.limits.dailyPlaces],
                    ["Requisições no mês", s.usage.month.requests, s.usage.limits.monthlyRequests],
                  ].map(([label, v, max]) => (
                    <div key={String(label)} className="rounded-xl border p-3">
                      <p className="text-xs text-muted">{label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(Number(v))} <span className="text-xs font-normal text-muted">/ {formatNumber(Number(max))}</span></p>
                      <div className="mt-2 h-1.5 rounded-full bg-surface-muted">
                        <div className={cn("h-full rounded-full", pct(Number(v), Number(max)) > 85 ? "bg-danger" : "bg-primary")} style={{ width: `${pct(Number(v), Number(max))}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl border p-3">
                    <p className="text-xs text-muted">Custo estimado no mês</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">US$ {s.usage.month.estimatedCostUsd.toFixed(2)}</p>
                    <p className="mt-1 text-[11px] text-muted">Estimativa local; confira o faturamento no Google Cloud.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title="Remover chave do Google?" destructive
        description="O Hunter não conseguirá buscar leads até uma nova chave ser cadastrada." confirmLabel="Remover" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

interface Prospecting {
  dailySearchLimit: number;
  monthlyRequestBudget: number;
  favoriteNiches: string[];
  dailyMessageLimit: number;
  messageIntervalSec: number;
  maxUnansweredMessages: number;
  senderName: string | null;
  serviceOffered: string | null;
}

export function ProspectingSection() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["integrations", "prospecting"], queryFn: () => api<Prospecting>("/api/integrations/prospecting") });
  const catalog = useQuery({ queryKey: ["office", "catalog"], queryFn: () => api<{ niches: { key: string; label: string }[] }>("/api/office/catalog"), staleTime: Infinity });
  const [form, setForm] = useState<Prospecting | null>(null);
  useEffect(() => {
    if (data.data) setForm(data.data);
  }, [data.data]);
  const save = useMutation({
    mutationFn: (body: Prospecting) => api<Prospecting>("/api/integrations/prospecting", { method: "PUT", body }),
    onSuccess: () => {
      toast.success("Preferências de prospecção salvas");
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Prospecção</CardTitle>
          <CardDescription>Limites de custo e nichos favoritos (dão pontos no score do Scout).</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!form ? (
          <Skeleton className="h-32" />
        ) : (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <Field label="Máx. de lugares por dia" htmlFor="dl">
                <Input id="dl" type="number" min={10} max={10000} value={form.dailySearchLimit} onChange={(e) => setForm({ ...form, dailySearchLimit: Number(e.target.value) })} />
              </Field>
              <Field label="Máx. de requisições por mês" htmlFor="mr">
                <Input id="mr" type="number" min={10} max={100000} value={form.monthlyRequestBudget} onChange={(e) => setForm({ ...form, monthlyRequestBudget: Number(e.target.value) })} />
              </Field>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Perfil comercial</p>
              <p className="mb-3 text-xs text-muted">Quem assina as mensagens geradas (Writer e "Gerar mensagem" da Central) e o que você oferece.</p>
              <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                <Field label="Seu nome" htmlFor="pf-name"><Input id="pf-name" value={form.senderName ?? ""} onChange={(e) => setForm({ ...form, senderName: e.target.value })} placeholder="Lucas" /></Field>
                <Field label="Serviço oferecido" htmlFor="pf-service"><Input id="pf-service" value={form.serviceOffered ?? ""} onChange={(e) => setForm({ ...form, serviceOffered: e.target.value })} placeholder="criação de sites e automações" /></Field>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">WhatsApp — proteção de volume</p>
              <p className="mb-3 text-xs text-muted">Valores baixos protegem o número contra bloqueio. Recomendado: até 40/dia e 90s ou mais entre envios.</p>
              <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
                <Field label="Mensagens por dia" htmlFor="wl"><Input id="wl" type="number" min={1} max={500} value={form.dailyMessageLimit} onChange={(e) => setForm({ ...form, dailyMessageLimit: Number(e.target.value) })} /></Field>
                <Field label="Intervalo mínimo (s)" htmlFor="wi"><Input id="wi" type="number" min={15} max={3600} value={form.messageIntervalSec} onChange={(e) => setForm({ ...form, messageIntervalSec: Number(e.target.value) })} /></Field>
                <Field label="Máx. sem resposta" htmlFor="wu"><Input id="wu" type="number" min={1} max={10} value={form.maxUnansweredMessages} onChange={(e) => setForm({ ...form, maxUnansweredMessages: Number(e.target.value) })} /></Field>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Nichos favoritos</p>
              <div className="flex flex-wrap gap-1.5">
                {catalog.data?.niches.map((n) => {
                  const on = form.favoriteNiches.includes(n.key);
                  return (
                    <button key={n.key} type="button" aria-pressed={on}
                      onClick={() => setForm({ ...form, favoriteNiches: on ? form.favoriteNiches.filter((k) => k !== n.key) : [...form.favoriteNiches, n.key] })}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary-soft text-primary" : "hover:border-primary/50")}>
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button type="submit" loading={save.isPending}>Salvar</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
