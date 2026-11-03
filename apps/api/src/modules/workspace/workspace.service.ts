import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { conflict, notFound } from "../../lib/errors.js";
import { officeEvents } from "../../office/events/office-events.js";

const TZ = "America/Sao_Paulo";
const DAY = 86_400_000;

function localDayBounds(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  const start = new Date(local.getTime() + offset);
  return { start, end: new Date(start.getTime() + DAY) };
}

// ── Agenda ──

const taskInclude = { lead: { select: { id: true, companyName: true, phone: true } }, assignee: { select: { id: true, name: true } } } as const;

/** "Minha Agenda": hoje, atrasadas, próximas, reuniões e leads parados. */
export async function getAgenda(organizationId: string, userId: string, onlyMine: boolean) {
  const { start, end } = localDayBounds();
  const base: Prisma.TaskWhereInput = {
    organizationId,
    status: "PENDING",
    ...(onlyMine ? { assigneeId: userId } : {}),
    OR: [{ leadId: null }, { lead: { deletedAt: null } }],
  };
  const staleBefore = new Date(Date.now() - 7 * DAY);
  const [overdue, today, upcoming, meetings, stale] = await Promise.all([
    prisma.task.findMany({ where: { ...base, dueAt: { lt: start } }, orderBy: { dueAt: "asc" }, include: taskInclude, take: 100 }),
    prisma.task.findMany({ where: { ...base, dueAt: { gte: start, lt: end } }, orderBy: { dueAt: "asc" }, include: taskInclude }),
    prisma.task.findMany({ where: { ...base, dueAt: { gte: end, lt: new Date(end.getTime() + 7 * DAY) } }, orderBy: { dueAt: "asc" }, include: taskInclude }),
    prisma.task.findMany({ where: { ...base, type: "MEETING", dueAt: { gte: start } }, orderBy: { dueAt: "asc" }, include: taskInclude, take: 20 }),
    // Leads em etapas abertas sem nenhuma atividade há 7 dias e sem tarefa pendente.
    prisma.lead.findMany({
      where: {
        organizationId,
        deletedAt: null,
        stage: { kind: "OPEN", key: { not: "new" } },
        ...(onlyMine ? { ownerId: userId } : {}),
        activities: { none: { createdAt: { gte: staleBefore } } },
        tasks: { none: { status: "PENDING" } },
      },
      orderBy: { updatedAt: "asc" },
      take: 30,
      select: { id: true, companyName: true, lastContactAt: true, updatedAt: true, stage: { select: { name: true } } },
    }),
  ]);
  return { overdue, today, upcoming, meetings, stale };
}

// ── Notificações internas ──

/** Gera lembretes de tarefas que vencem na próxima hora (ou já venceram) — uma vez por tarefa. */
export async function generateTaskNotifications(now = new Date()) {
  const due = await prisma.task.findMany({
    where: { status: "PENDING", notifiedAt: null, dueAt: { lte: new Date(now.getTime() + 3_600_000) }, assigneeId: { not: null } },
    include: { lead: { select: { id: true, companyName: true } } },
    take: 200,
  });
  for (const t of due) {
    const late = t.dueAt < now;
    const n = await prisma.notification.create({
      data: {
        organizationId: t.organizationId,
        userId: t.assigneeId!,
        title: late ? `Tarefa atrasada: ${t.title}` : `Tarefa em breve: ${t.title}`,
        body: t.lead ? t.lead.companyName : null,
        link: t.lead ? `/crm?lead=${t.lead.id}` : "/agenda",
      },
    });
    await prisma.task.update({ where: { id: t.id }, data: { notifiedAt: now } });
    officeEvents.publish(t.organizationId, "notification:new", { userId: t.assigneeId, notification: n });
  }
  return due.length;
}

export async function listNotifications(organizationId: string, userId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { organizationId, userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { organizationId, userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(organizationId: string, userId: string, id?: string) {
  await prisma.notification.updateMany({ where: { organizationId, userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
}

// ── Relatórios ──

export async function getReport(organizationId: string, days: number) {
  const since = new Date(Date.now() - days * DAY);
  const [stages, leadsByStage, created, bySource, byNiche, activityCounts, msgOut, msgIn, conversationsReplied, byUser, tasksDone] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { organizationId, pipeline: { isDefault: true } }, orderBy: { position: "asc" } }),
    prisma.lead.groupBy({ by: ["stageId"], where: { organizationId, deletedAt: null }, _count: { _all: true } }),
    prisma.lead.count({ where: { organizationId, deletedAt: null, createdAt: { gte: since } } }),
    prisma.$queryRaw<{ label: string; total: bigint; won: bigint }[]>`
      SELECT COALESCE(s.label, 'Sem origem') AS label, COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE st.kind = 'WON')::bigint AS won
        FROM "Lead" l LEFT JOIN "LeadSource" s ON s.id = l."sourceId" JOIN "PipelineStage" st ON st.id = l."stageId"
       WHERE l."organizationId" = ${organizationId}::uuid AND l."deletedAt" IS NULL
       GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ label: string; total: bigint; won: bigint; contacted: bigint }[]>`
      SELECT COALESCE(l.niche, 'Sem nicho') AS label, COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE st.kind = 'WON')::bigint AS won,
             COUNT(*) FILTER (WHERE l."lastContactAt" IS NOT NULL)::bigint AS contacted
        FROM "Lead" l JOIN "PipelineStage" st ON st.id = l."stageId"
       WHERE l."organizationId" = ${organizationId}::uuid AND l."deletedAt" IS NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    prisma.leadActivity.groupBy({ by: ["type"], where: { organizationId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.whatsAppMessage.count({ where: { organizationId, direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "READ"] }, createdAt: { gte: since } } }),
    prisma.whatsAppMessage.count({ where: { organizationId, direction: "INBOUND", createdAt: { gte: since } } }),
    prisma.whatsAppConversation.count({ where: { organizationId, lastInboundAt: { gte: since } } }),
    prisma.$queryRaw<{ name: string; activities: bigint; contacts: bigint; won: bigint }[]>`
      SELECT u.name, COUNT(*)::bigint AS activities,
             COUNT(*) FILTER (WHERE a.type IN ('MESSAGE_SENT'))::bigint AS contacts,
             COUNT(*) FILTER (WHERE a.type = 'CONVERTED')::bigint AS won
        FROM "LeadActivity" a JOIN "User" u ON u.id = a."actorId"
       WHERE a."organizationId" = ${organizationId}::uuid AND a."createdAt" >= ${since}
       GROUP BY u.name ORDER BY 2 DESC`,
    prisma.task.count({ where: { organizationId, status: "DONE", completedAt: { gte: since } } }),
  ]);

  const count = new Map(leadsByStage.map((s) => [s.stageId, s._count._all]));
  // Funil cumulativo: quantos chegaram "até" cada etapa aberta (inclui quem passou dela).
  const open = stages.filter((s) => s.kind !== "LOST");
  const funnel = open.map((s, i) => {
    const reached = open.slice(i).reduce((sum, st) => sum + (count.get(st.id) ?? 0), 0);
    return { key: s.key, name: s.name, current: count.get(s.id) ?? 0, reached };
  });
  const funnelWithRates = funnel.map((f, i) => ({
    ...f,
    rateFromPrevious: i === 0 || funnel[i - 1]!.reached === 0 ? null : Math.round((f.reached / funnel[i - 1]!.reached) * 1000) / 10,
  }));
  const act = Object.fromEntries(activityCounts.map((a) => [a.type, a._count._all]));
  const n = (v: bigint) => Number(v);

  return {
    periodDays: days,
    totals: {
      leadsCreated: created,
      lost: count.get(stages.find((s) => s.kind === "LOST")?.id ?? "") ?? 0,
      contacts: act.MESSAGE_SENT ?? 0,
      replies: act.REPLY_RECEIVED ?? 0,
      meetings: act.MEETING_SCHEDULED ?? 0,
      proposals: act.PROPOSAL_SENT ?? 0,
      conversions: act.CONVERTED ?? 0,
      tasksDone,
    },
    whatsapp: {
      sent: msgOut,
      received: msgIn,
      conversationsWithReply: conversationsReplied,
    },
    funnel: funnelWithRates,
    bySource: bySource.map((r) => ({ label: r.label, total: n(r.total), won: n(r.won) })),
    byNiche: byNiche.map((r) => ({ label: r.label, total: n(r.total), contacted: n(r.contacted), won: n(r.won) })),
    byUser: byUser.map((r) => ({ name: r.name, activities: n(r.activities), contacts: n(r.contacts), won: n(r.won) })),
  };
}

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Evita injeção de fórmula ao abrir no Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function exportLeadsCsv(organizationId: string) {
  const leads = await prisma.lead.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { stage: { select: { name: true } }, owner: { select: { name: true } }, tags: { select: { tag: { select: { name: true } } } } },
  });
  const header = ["Empresa", "Contato", "Nicho", "Cidade", "Estado", "Telefone", "Email", "Website", "Etapa", "Score", "Responsável", "Etiquetas", "Último contato", "Criado em"];
  const rows = leads.map((l) => [
    l.companyName, l.contactName, l.niche, l.city, l.state, l.phone, l.email, l.website, l.stage.name, l.score, l.owner?.name,
    l.tags.map((t) => t.tag.name).join(", "), l.lastContactAt?.toISOString(), l.createdAt.toISOString(),
  ]);
  return "﻿" + [header, ...rows].map((r) => r.map(csv).join(";")).join("\r\n");
}

// ── Administração do CRM ──

export async function updateStage(organizationId: string, id: string, data: { name?: string; color?: string }) {
  const { count } = await prisma.pipelineStage.updateMany({ where: { id, organizationId }, data });
  if (!count) throw notFound("Etapa não encontrada");
}

export async function deleteTag(organizationId: string, id: string) {
  const { count } = await prisma.tag.deleteMany({ where: { id, organizationId } });
  if (!count) throw notFound("Etiqueta não encontrada");
}

export async function listCustomFields(organizationId: string) {
  return prisma.customFieldDefinition.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
}

export async function createCustomField(organizationId: string, input: { label: string; type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT"; options: string[] }) {
  const key = input.label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "campo";
  try {
    return await prisma.customFieldDefinition.create({ data: { organizationId, key, label: input.label, type: input.type, options: input.type === "SELECT" ? input.options : [] } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw conflict("Já existe um campo com este nome");
    throw err;
  }
}

export async function deleteCustomField(organizationId: string, id: string) {
  const { count } = await prisma.customFieldDefinition.deleteMany({ where: { id, organizationId } });
  if (!count) throw notFound();
}

/** Salva valores de campos personalizados, aceitando só campos definidos e tipos válidos. */
export async function setLeadCustomFields(organizationId: string, leadId: string, values: Record<string, unknown>) {
  const [lead, defs] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, organizationId, deletedAt: null } }),
    listCustomFields(organizationId),
  ]);
  if (!lead) throw notFound("Lead não encontrado");
  const clean: Record<string, string | number | boolean | null> = {};
  for (const d of defs) {
    if (!(d.key in values)) continue;
    const v = values[d.key];
    if (v === null || v === "") clean[d.key] = null;
    else if (d.type === "NUMBER" && !Number.isNaN(Number(v))) clean[d.key] = Number(v);
    else if (d.type === "BOOLEAN") clean[d.key] = v === true || v === "true";
    else if (d.type === "SELECT" && d.options.includes(String(v))) clean[d.key] = String(v);
    else if (d.type === "DATE" && !Number.isNaN(Date.parse(String(v)))) clean[d.key] = String(v).slice(0, 10);
    else if (d.type === "TEXT") clean[d.key] = String(v).slice(0, 500);
  }
  const merged = { ...(lead.customFields as Record<string, unknown>), ...clean };
  await prisma.lead.update({ where: { id: leadId }, data: { customFields: merged as Prisma.InputJsonValue } });
  return merged;
}

// ── Auditoria e busca global ──

export async function listAudit(organizationId: string, q: { action?: string; limit: number }) {
  return prisma.auditLog.findMany({
    where: { organizationId, ...(q.action ? { action: { startsWith: q.action } } : {}) },
    orderBy: { createdAt: "desc" },
    take: q.limit,
    include: { user: { select: { name: true, email: true } } },
  });
}

export async function globalSearch(organizationId: string, q: string) {
  const digits = q.replace(/\D/g, "");
  const [leads, tasks] = await Promise.all([
    prisma.lead.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phoneE164: { contains: digits } }] : []),
        ],
      },
      take: 8,
      select: { id: true, companyName: true, city: true, stage: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId, status: "PENDING", title: { contains: q, mode: "insensitive" } },
      take: 5,
      select: { id: true, title: true, dueAt: true, leadId: true },
    }),
  ]);
  return { leads, tasks };
}
