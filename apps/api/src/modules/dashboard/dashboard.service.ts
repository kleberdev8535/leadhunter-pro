import { prisma } from "../../lib/prisma.js";
import type { ActivityType } from "../../generated/prisma/client.js";

const TZ = "America/Sao_Paulo";

// Etapas que contam como "qualificado ou além" (exceto perdido).
const QUALIFIED_KEYS = ["qualified", "first_contact", "awaiting_reply", "negotiation", "meeting", "proposal", "won"];

// Expressão SQL que converte uma coluna timestamp (UTC, sem fuso) para a data local.
const localDate = (col: string) => `(("${col}" AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date`;

type CountRow = { type: ActivityType; leads: bigint };
type SeriesRow = { day: Date; total: bigint };

async function distinctLeadsByActivity(organizationId: string, sinceLocalDays: number | "today") {
  // sinceLocalDays = N → desde o início do dia local de N-1 dias atrás
  const offset = sinceLocalDays === "today" ? 0 : sinceLocalDays - 1;
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT "type", COUNT(DISTINCT "leadId")::bigint AS leads
       FROM "LeadActivity"
      WHERE "organizationId" = $1::uuid
        AND ${localDate("createdAt")} >= ((now() AT TIME ZONE '${TZ}')::date - $2::int)
      GROUP BY "type"`,
    organizationId,
    offset,
  );
  const map = new Map(rows.map((r) => [r.type, Number(r.leads)]));
  return (t: ActivityType) => map.get(t) ?? 0;
}

async function dailySeries(organizationId: string, days: number, sql: string): Promise<{ date: string; total: number }[]> {
  const rows = await prisma.$queryRawUnsafe<SeriesRow[]>(
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE '${TZ}')::date - ($2::int - 1), (now() AT TIME ZONE '${TZ}')::date, '1 day')::date AS day
     ), counts AS (${sql})
     SELECT d.day, COALESCE(c.total, 0)::bigint AS total
       FROM days d LEFT JOIN counts c ON c.day = d.day
      ORDER BY d.day`,
    organizationId,
    days,
  );
  return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), total: Number(r.total) }));
}

export async function getSummary(organizationId: string, days: number) {
  const baseLead = { organizationId, deletedAt: null };

  const [totalLeads, newLeads, withoutWebsite, qualified, converted, createdInPeriod, period, today, foundToday] =
    await Promise.all([
      prisma.lead.count({ where: baseLead }),
      prisma.lead.count({ where: { ...baseLead, stage: { key: "new" } } }),
      prisma.lead.count({ where: { ...baseLead, website: null } }),
      prisma.lead.count({ where: { ...baseLead, stage: { key: { in: QUALIFIED_KEYS } } } }),
      prisma.lead.count({ where: { ...baseLead, stage: { kind: "WON" } } }),
      prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*)::bigint AS total FROM "Lead"
          WHERE "organizationId" = $1::uuid AND "deletedAt" IS NULL
            AND ${localDate("createdAt")} >= ((now() AT TIME ZONE '${TZ}')::date - ($2::int - 1))`,
        organizationId,
        days,
      ),
      distinctLeadsByActivity(organizationId, days),
      distinctLeadsByActivity(organizationId, "today"),
      prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*)::bigint AS total FROM "Lead"
          WHERE "organizationId" = $1::uuid AND "deletedAt" IS NULL
            AND ${localDate("createdAt")} = (now() AT TIME ZONE '${TZ}')::date`,
        organizationId,
      ),
    ]);

  return {
    periodDays: days,
    cards: {
      totalLeads,
      newLeads,
      withoutWebsite,
      qualified,
      contacted: period("MESSAGE_SENT"),
      replied: period("REPLY_RECEIVED"),
      meetings: period("MEETING_SCHEDULED"),
      converted,
      conversionRate: totalLeads === 0 ? 0 : Math.round((converted / totalLeads) * 1000) / 10,
      createdInPeriod: Number(createdInPeriod[0]?.total ?? 0),
    },
    today: {
      found: Number(foundToday[0]?.total ?? 0),
      approached: today("MESSAGE_SENT"),
      replied: today("REPLY_RECEIVED"),
      interested: today("INTEREST_SHOWN"),
      converted: today("CONVERTED"),
    },
  };
}

export async function getCharts(organizationId: string, days: number) {
  const [leadsPerDay, conversionsPerDay, byNiche, byCity, stages, stageCounts] = await Promise.all([
    dailySeries(
      organizationId,
      days,
      `SELECT ${localDate("createdAt")} AS day, COUNT(*) AS total FROM "Lead"
        WHERE "organizationId" = $1::uuid AND "deletedAt" IS NULL GROUP BY 1`,
    ),
    dailySeries(
      organizationId,
      days,
      `SELECT ${localDate("createdAt")} AS day, COUNT(DISTINCT "leadId") AS total FROM "LeadActivity"
        WHERE "organizationId" = $1::uuid AND "type" = 'CONVERTED' GROUP BY 1`,
    ),
    prisma.lead.groupBy({
      by: ["niche"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
      orderBy: { _count: { niche: "desc" } },
      take: 8,
    }),
    prisma.lead.groupBy({
      by: ["city"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
      orderBy: { _count: { city: "desc" } },
      take: 8,
    }),
    prisma.pipelineStage.findMany({
      where: { organizationId, pipeline: { isDefault: true } },
      orderBy: { position: "asc" },
      select: { id: true, key: true, name: true, color: true, kind: true },
    }),
    prisma.lead.groupBy({
      by: ["stageId"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const countByStage = new Map(stageCounts.map((s) => [s.stageId, s._count._all]));

  return {
    leadsPerDay,
    conversionsPerDay,
    byNiche: byNiche.map((r) => ({ label: r.niche ?? "Sem nicho", total: r._count._all })),
    byCity: byCity.map((r) => ({ label: r.city ?? "Sem cidade", total: r._count._all })),
    funnel: stages.map((s) => ({ ...s, total: countByStage.get(s.id) ?? 0 })),
  };
}

export async function getRecentActivities(organizationId: string, limit: number) {
  return prisma.leadActivity.findMany({
    where: { organizationId, lead: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      description: true,
      createdAt: true,
      lead: { select: { id: true, companyName: true } },
      actor: { select: { id: true, name: true } },
    },
  });
}
