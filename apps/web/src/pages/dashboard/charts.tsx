import { useId, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, BarChart2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/utils";

const axisTick = { fill: "var(--muted)", fontSize: 11 };
const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

function ChartTooltip({ active, payload, label, unit, labelFormat }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit: string;
  labelFormat?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{labelFormat && label ? labelFormat(label) : label}</p>
      <p className="mt-0.5 font-semibold text-foreground">
        {formatNumber(payload[0]?.value ?? 0)} {unit}
      </p>
    </div>
  );
}

/** Card de gráfico com alternância para tabela, para que nenhum dado dependa só de cor/forma. */
export function ChartCard({
  title,
  description,
  rows,
  columns,
  children,
  empty,
}: {
  title: string;
  description?: string;
  rows: (string | number)[][];
  columns: [string, string];
  children: ReactNode;
  empty?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => setAsTable((t) => !t)}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            aria-label={asTable ? "Ver como gráfico" : "Ver como tabela"}
            title={asTable ? "Ver como gráfico" : "Ver como tabela"}
          >
            {asTable ? <BarChart2 className="size-4" /> : <Table2 className="size-4" />}
          </button>
        )}
      </CardHeader>
      <CardContent>
        {empty ??
          (asTable ? (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-medium">{columns[0]}</th>
                    <th className="pb-2 text-right font-medium">{columns[1]}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([a, b]) => (
                    <tr key={String(a)} className="border-t">
                      <td className="py-1.5">{a}</td>
                      <td className="py-1.5 text-right tabular-nums">{typeof b === "number" ? formatNumber(b) : b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            children
          ))}
      </CardContent>
    </Card>
  );
}

export function DailyAreaChart({ data, color, unit }: { data: { date: string; total: number }[]; color: string; unit: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="h-56" role="img" aria-label={`Série diária de ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
            content={<ChartTooltip unit={unit} labelFormat={shortDate} />}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={color}
            strokeWidth={2}
            fill={`url(#g${id})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyBarChart({ data, color, unit }: { data: { date: string; total: number }[]; color: string; unit: string }) {
  return (
    <div className="h-56" role="img" aria-label={`Série diária de ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--surface-muted)" }} content={<ChartTooltip unit={unit} labelFormat={shortDate} />} />
          <Bar dataKey="total" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras horizontais com rótulo e valor em texto (o valor não depende do gráfico para ser lido). */
export function RankBars({ data, color, unit }: { data: { label: string; total: number }[]; color: string; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} className="group" title={`${d.label}: ${formatNumber(d.total)} ${unit}`}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate text-foreground">{d.label}</span>
            <span className="tabular-nums text-muted">{formatNumber(d.total)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-muted">
            <div
              className="h-2 rounded-full transition-[width] duration-700 ease-out group-hover:opacity-80"
              style={{ width: `${(d.total / max) * 100}%`, backgroundColor: color, minWidth: d.total > 0 ? 6 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
