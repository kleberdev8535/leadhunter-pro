import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { TaskContext } from "../../tasks/task-context.js";
import { generateReportParams } from "../../tasks/task.schemas.js";
import { getCharts, getSummary } from "../../modules/dashboard/dashboard.service.js";

/** MetricsWorker → GENERATE_REPORT: consolida indicadores reais do banco num relatório salvo. */
export async function buildReport(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const { days } = generateReportParams.parse(ctx.task.parameters);
  const org = ctx.organizationId;
  const summary = await getSummary(org, days);
  await ctx.progress(35);
  const charts = await getCharts(org, days);
  await ctx.progress(70);

  const since = new Date(Date.now() - days * 86_400_000);
  const tasks = await prisma.agentTask.groupBy({
    by: ["taskType", "status"],
    where: { organizationId: org, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const scoreDist = await prisma.$queryRaw<{ tier: string; total: bigint }[]>`
    SELECT CASE WHEN score >= 60 THEN 'alto' WHEN score >= 35 THEN 'médio' ELSE 'baixo' END AS tier, COUNT(*)::bigint AS total
      FROM "Lead" WHERE "organizationId" = ${org}::uuid AND "deletedAt" IS NULL GROUP BY 1`;
  await ctx.progress(95);

  return {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    cards: summary.cards,
    today: summary.today,
    funnel: charts.funnel.map((s) => ({ stage: s.name, total: s.total })),
    topNiches: charts.byNiche,
    topCities: charts.byCity,
    scoreDistribution: scoreDist.map((r) => ({ tier: r.tier, total: Number(r.total) })),
    agentTasks: tasks.map((t) => ({ taskType: t.taskType, status: t.status, total: t._count._all })),
  };
}
