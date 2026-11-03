import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity,
  CalendarCheck,
  CircleDollarSign,
  Globe,
  Inbox,
  MessageCircleReply,
  Percent,
  Send,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthProvider";
import { cn, formatNumber, formatPercent, formatRelative } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/states";
import { ChartCard, DailyAreaChart, DailyBarChart, RankBars } from "./charts";
import type { DashboardCharts, DashboardSummary, RecentActivity } from "./types";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_KEY = "lh-dashboard-period";

function usePersistentPeriod(): [Period, (p: Period) => void] {
  const [period, setPeriod] = useState<Period>(() => {
    const saved = Number(localStorage.getItem(PERIOD_KEY));
    return (PERIODS as readonly number[]).includes(saved) ? (saved as Period) : 30;
  });
  useEffect(() => localStorage.setItem(PERIOD_KEY, String(period)), [period]);
  return [period, setPeriod];
}

interface Kpi {
  label: string;
  value: string;
  icon: LucideIcon;
  hint: string;
}

function KpiCard({ kpi, index }: { kpi: Kpi; index: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
      <Card className="group h-full p-4 transition-all hover:-translate-y-0.5 hover:shadow-md" title={kpi.hint}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted">{kpi.label}</p>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary-soft text-primary transition-transform group-hover:scale-110">
            <kpi.icon className="size-3.5" />
          </div>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{kpi.value}</p>
        <p className="mt-1 line-clamp-1 text-[11px] text-muted">{kpi.hint}</p>
      </Card>
    </motion.div>
  );
}

const ACTIVITY_LABEL: Record<string, string> = {
  LEAD_FOUND: "Lead encontrado",
  LEAD_CREATED: "Adicionado ao CRM",
  STAGE_CHANGED: "Mudou de etapa",
  QUALIFIED: "Qualificado",
  MESSAGE_SENT: "Mensagem enviada",
  REPLY_RECEIVED: "Resposta recebida",
  MEETING_SCHEDULED: "Reunião agendada",
  PROPOSAL_SENT: "Proposta enviada",
  CONVERTED: "Convertido",
  NOTE_ADDED: "Nota",
};

export function DashboardPage() {
  const { me } = useAuth();
  const [period, setPeriod] = usePersistentPeriod();

  const summary = useQuery({
    queryKey: ["dashboard", "summary", period],
    queryFn: () => api<DashboardSummary>(`/api/dashboard/summary?days=${period}`),
  });
  const charts = useQuery({
    queryKey: ["dashboard", "charts", period],
    queryFn: () => api<DashboardCharts>(`/api/dashboard/charts?days=${period}`),
  });
  const activities = useQuery({
    queryKey: ["dashboard", "activities"],
    queryFn: () => api<RecentActivity[]>("/api/dashboard/activities?limit=8"),
  });

  const c = summary.data?.cards;
  const kpis: Kpi[] = c
    ? [
        { label: "Total de leads", value: formatNumber(c.totalLeads), icon: Users, hint: `${formatNumber(c.createdInPeriod)} nos últimos ${period} dias` },
        { label: "Leads novos", value: formatNumber(c.newLeads), icon: Inbox, hint: "Na etapa Leads novos" },
        { label: "Sem site informado", value: formatNumber(c.withoutWebsite), icon: Globe, hint: "A fonte não informou site — confirme antes de abordar" },
        { label: "Qualificados", value: formatNumber(c.qualified), icon: Target, hint: "Da etapa Qualificado em diante, exceto perdidos" },
        { label: "Contatos realizados", value: formatNumber(c.contacted), icon: Send, hint: `Leads com mensagem enviada em ${period} dias` },
        { label: "Respostas recebidas", value: formatNumber(c.replied), icon: MessageCircleReply, hint: `Leads que responderam em ${period} dias` },
        { label: "Reuniões agendadas", value: formatNumber(c.meetings), icon: CalendarCheck, hint: `Em ${period} dias` },
        { label: "Clientes convertidos", value: formatNumber(c.converted), icon: CircleDollarSign, hint: "Na etapa Cliente convertido" },
        { label: "Taxa de conversão", value: formatPercent(c.conversionRate), icon: Percent, hint: "Convertidos ÷ total de leads" },
      ]
    : [];

  const noLeads = c?.totalLeads === 0;
  const firstName = me?.user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">Visão geral da operação de prospecção de {me?.organization.name}.</p>
        </div>
        <div role="radiogroup" aria-label="Período" className="inline-flex self-start rounded-lg border bg-surface p-1 shadow-xs">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                period === p ? "bg-primary text-white shadow-sm dark:text-slate-950" : "text-muted hover:text-foreground",
              )}
            >
              {p} dias
            </button>
          ))}
        </div>
      </div>

      {summary.isError ? (
        <Card>
          <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {summary.isPending
            ? Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
            : kpis.map((k, i) => <KpiCard key={k.label} kpi={k} index={i} />)}
        </div>
      )}

      {noLeads && (
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-transparent">
            <EmptyState
              icon={Sparkles}
              title="Sua base ainda está vazia"
              description="Os indicadores são calculados a partir dos seus leads reais. A busca no Google Maps chega na Etapa 2 e o CRM com cadastro manual na Etapa 3."
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Performance de Prospecção</CardTitle>
            <CardDescription>Hoje, no fuso de Brasília</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {summary.isPending ? (
            <Skeleton className="h-20" />
          ) : summary.data ? (
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ["Encontrados", summary.data.today.found],
                  ["Abordados", summary.data.today.approached],
                  ["Responderam", summary.data.today.replied],
                  ["Interessados", summary.data.today.interested],
                  ["Viraram clientes", summary.data.today.converted],
                ] as const
              ).map(([label, value], i) => (
                <li key={label} className="relative rounded-xl border bg-surface-muted/50 p-4">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Passo {i + 1}</span>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(value)}</p>
                  <p className="text-xs text-muted">{label}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </CardContent>
      </Card>

      {charts.isError ? (
        <Card>
          <ErrorState message={charts.error.message} onRetry={() => void charts.refetch()} />
        </Card>
      ) : charts.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Leads captados por dia"
            description={`Últimos ${period} dias`}
            columns={["Dia", "Leads"]}
            rows={charts.data.leadsPerDay.map((d) => [d.date.split("-").reverse().join("/"), d.total])}
          >
            <DailyAreaChart data={charts.data.leadsPerDay} color="var(--chart-1)" unit="leads" />
          </ChartCard>
          <ChartCard
            title="Evolução de conversões"
            description={`Leads convertidos por dia, últimos ${period} dias`}
            columns={["Dia", "Conversões"]}
            rows={charts.data.conversionsPerDay.map((d) => [d.date.split("-").reverse().join("/"), d.total])}
          >
            <DailyBarChart data={charts.data.conversionsPerDay} color="var(--chart-2)" unit="conversões" />
          </ChartCard>
          <ChartCard
            title="Funil de prospecção"
            description="Leads atualmente em cada etapa"
            columns={["Etapa", "Leads"]}
            rows={charts.data.funnel.map((s) => [s.name, s.total])}
          >
            <RankBars data={charts.data.funnel.map((s) => ({ label: s.name, total: s.total }))} color="var(--chart-1)" unit="leads" />
          </ChartCard>
          <div className="grid gap-4 sm:grid-cols-2">
            <ChartCard
              title="Leads por nicho"
              columns={["Nicho", "Leads"]}
              rows={charts.data.byNiche.map((d) => [d.label, d.total])}
              empty={charts.data.byNiche.length === 0 ? <p className="py-8 text-center text-sm text-muted">Sem dados ainda</p> : undefined}
            >
              <RankBars data={charts.data.byNiche} color="var(--chart-1)" unit="leads" />
            </ChartCard>
            <ChartCard
              title="Leads por cidade"
              columns={["Cidade", "Leads"]}
              rows={charts.data.byCity.map((d) => [d.label, d.total])}
              empty={charts.data.byCity.length === 0 ? <p className="py-8 text-center text-sm text-muted">Sem dados ainda</p> : undefined}
            >
              <RankBars data={charts.data.byCity} color="var(--chart-1)" unit="leads" />
            </ChartCard>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Atividades recentes</CardTitle>
            <CardDescription>Últimos eventos registrados nos leads</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {activities.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : activities.isError ? (
            <ErrorState message={activities.error.message} onRetry={() => void activities.refetch()} />
          ) : activities.data.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Nenhuma atividade ainda"
              description="Cada contato, mudança de etapa e nota vai aparecer aqui, com data e horário."
              className="py-8"
            />
          ) : (
            <ul className="divide-y">
              {activities.data.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{a.lead.companyName}</span>
                      <span className="text-muted"> · {ACTIVITY_LABEL[a.type] ?? a.description}</span>
                    </p>
                    {a.actor && <p className="text-xs text-muted">por {a.actor.name}</p>}
                  </div>
                  <time dateTime={a.createdAt} className="shrink-0 text-xs text-muted">
                    {formatRelative(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted">
        Dados calculados em tempo real a partir do banco. <Link to="/configuracoes" className="text-primary hover:underline">Configurações</Link>
      </p>
    </div>
  );
}
