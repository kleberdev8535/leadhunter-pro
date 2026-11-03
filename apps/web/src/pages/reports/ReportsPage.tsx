import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { API_BASE, api, getAccessToken } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/states";

interface Report {
  periodDays: number;
  totals: Record<"leadsCreated" | "lost" | "contacts" | "replies" | "meetings" | "proposals" | "conversions" | "tasksDone", number>;
  whatsapp: { sent: number; received: number; conversationsWithReply: number };
  funnel: { key: string; name: string; current: number; reached: number; rateFromPrevious: number | null }[];
  bySource: { label: string; total: number; won: number }[];
  byNiche: { label: string; total: number; contacted: number; won: number }[];
  byUser: { name: string; activities: number; contacts: number; won: number }[];
}

const PERIODS = [7, 30, 90, 365];
const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 1000) / 10}%`);

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-muted">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${max ? Math.max((value / max) * 100, value ? 2 : 0) : 0}%` }} />
    </div>
  );
}

export function ReportsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["reports", days], queryFn: () => api<Report>(`/api/workspace/reports?days=${days}`) });
  const [exporting, setExporting] = useState(false);

  // O CSV exige autenticação; baixamos via fetch com o token e salvamos como arquivo.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspace/reports/leads.csv`, { headers: { Authorization: `Bearer ${getAccessToken()}` }, credentials: "include" });
      if (!res.ok) throw new Error(`Falha ao exportar (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const r = q.data;
  const maxFunnel = Math.max(1, ...(r?.funnel.map((f) => f.reached) ?? [0]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="mt-1 text-sm text-muted">Funil, origem dos leads, nichos e produtividade, calculados a partir do banco.</p>
        </div>
        <div className="flex gap-2">
          <div role="radiogroup" aria-label="Período" className="inline-flex rounded-lg border bg-surface p-1">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={days === p} onClick={() => setDays(p)}
                className={cn("rounded-md px-3 py-1.5 text-xs font-medium", days === p ? "bg-primary text-white dark:text-slate-950" : "text-muted")}>{p === 365 ? "1 ano" : `${p} dias`}</button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void exportCsv()} loading={exporting}><Download /> Exportar leads (CSV)</Button>
        </div>
      </div>

      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
      ) : q.isError ? (
        <Card><ErrorState message={q.error.message} onRetry={() => void q.refetch()} /></Card>
      ) : r ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {([
              ["Leads novos", r.totals.leadsCreated],
              ["Contatos", r.totals.contacts],
              ["Respostas", r.totals.replies],
              ["Taxa de resposta", pct(r.totals.replies, r.totals.contacts)],
              ["Reuniões", r.totals.meetings],
              ["Propostas", r.totals.proposals],
              ["Conversões", r.totals.conversions],
              ["Tarefas feitas", r.totals.tasksDone],
            ] as const).map(([l, v]) => (
              <Card key={l} className="p-3">
                <p className="text-[11px] text-muted">{l}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{typeof v === "number" ? formatNumber(v) : v}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Funil de conversão</CardTitle><CardDescription>Quantos leads chegaram até cada etapa (inclui quem já passou dela) e a taxa em relação à etapa anterior.</CardDescription></div></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Etapa</th><th className="w-2/5 pb-2" /><th className="pb-2 text-right font-medium">Chegaram</th><th className="pb-2 text-right font-medium">Taxa</th></tr></thead>
                  <tbody>
                    {r.funnel.map((f) => (
                      <tr key={f.key} className="border-t">
                        <td className="py-2">{f.name}</td>
                        <td className="py-2 pr-3"><Bar value={f.reached} max={maxFunnel} /></td>
                        <td className="py-2 text-right tabular-nums">{f.reached}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{f.rateFromPrevious === null ? "—" : `${f.rateFromPrevious}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted">Perdidos no total: {r.totals.lost}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div><CardTitle>Por nicho</CardTitle><CardDescription>Leads, quantos já foram contatados e quantos viraram clientes.</CardDescription></div></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Nicho</th><th className="pb-2 text-right font-medium">Leads</th><th className="pb-2 text-right font-medium">Contatados</th><th className="pb-2 text-right font-medium">Clientes</th><th className="pb-2 text-right font-medium">Conversão</th></tr></thead>
                  <tbody>
                    {r.byNiche.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">Sem dados</td></tr>}
                    {r.byNiche.map((n) => (
                      <tr key={n.label} className="border-t">
                        <td className="py-2">{n.label}</td>
                        <td className="py-2 text-right tabular-nums">{n.total}</td>
                        <td className="py-2 text-right tabular-nums">{n.contacted}</td>
                        <td className="py-2 text-right tabular-nums">{n.won}</td>
                        <td className="py-2 text-right tabular-nums text-muted">{pct(n.won, n.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Por origem</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {r.bySource.length === 0 && <li className="text-sm text-muted">Sem dados</li>}
                  {r.bySource.map((s) => (
                    <li key={s.label}>
                      <div className="mb-1 flex justify-between text-xs"><span>{s.label}</span><span className="tabular-nums text-muted">{s.total} lead{s.total === 1 ? "" : "s"} · {s.won} cliente{s.won === 1 ? "" : "s"} ({pct(s.won, s.total)})</span></div>
                      <Bar value={s.total} max={Math.max(...r.bySource.map((x) => x.total))} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div><CardTitle>Produtividade e WhatsApp</CardTitle><CardDescription>Atividades registradas por pessoa no período.</CardDescription></div></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Enviadas</p><p className="text-lg font-semibold">{r.whatsapp.sent}</p></div>
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Recebidas</p><p className="text-lg font-semibold">{r.whatsapp.received}</p></div>
                  <div className="rounded-lg bg-surface-muted p-2"><p className="text-muted">Conversas com resposta</p><p className="text-lg font-semibold">{r.whatsapp.conversationsWithReply}</p></div>
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Pessoa</th><th className="pb-2 text-right font-medium">Atividades</th><th className="pb-2 text-right font-medium">Contatos</th><th className="pb-2 text-right font-medium">Conversões</th></tr></thead>
                  <tbody>
                    {r.byUser.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Sem atividades no período</td></tr>}
                    {r.byUser.map((u) => (
                      <tr key={u.name} className="border-t"><td className="py-2">{u.name}</td><td className="py-2 text-right tabular-nums">{u.activities}</td><td className="py-2 text-right tabular-nums">{u.contacts}</td><td className="py-2 text-right tabular-nums">{u.won}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
