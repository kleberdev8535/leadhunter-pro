import type { ActivityType, Prisma, SearchResult } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import type { LeadInput } from "./crm.schemas.js";

/** Score a partir do qual o lead entra direto na etapa "Lead qualificado". */
export const QUALIFIED_SCORE = 60;

/** Telefone brasileiro → E.164 quando dá para ter certeza; senão null. */
export function phoneToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return `+${digits}`;
  return null;
}

/** Atividades automáticas ao entrar em certas etapas, para a timeline e o dashboard. */
const STAGE_ACTIVITY: Record<string, { type: ActivityType; text: string } | undefined> = {
  qualified: { type: "QUALIFIED", text: "Lead qualificado" },
  meeting: { type: "MEETING_SCHEDULED", text: "Reunião agendada" },
  proposal: { type: "PROPOSAL_SENT", text: "Proposta enviada" },
  won: { type: "CONVERTED", text: "Cliente convertido" },
  lost: { type: "LOST", text: "Marcado como perdido" },
};

async function defaultPipeline(organizationId: string) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId, isDefault: true },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw notFound("Funil não encontrado");
  return pipeline;
}

export async function getPipeline(organizationId: string) {
  const p = await defaultPipeline(organizationId);
  return { id: p.id, name: p.name, stages: p.stages.map(({ id, key, name, color, kind, position }) => ({ id, key, name, color, kind, position })) };
}

const leadCardSelect = {
  id: true,
  companyName: true,
  contactName: true,
  niche: true,
  city: true,
  phone: true,
  phoneE164: true,
  website: true,
  websiteReported: true,
  score: true,
  interest: true,
  stageId: true,
  position: true,
  lastContactAt: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  tasks: { where: { status: "PENDING" as const }, orderBy: { dueAt: "asc" as const }, take: 1, select: { id: true, title: true, dueAt: true } },
} satisfies Prisma.LeadSelect;

type LeadCardRow = Prisma.LeadGetPayload<{ select: typeof leadCardSelect }>;

const toCard = (l: LeadCardRow) => ({
  ...l,
  tags: l.tags.map((t) => t.tag),
  nextTask: l.tasks[0] ?? null,
  tasks: undefined,
});

export async function listLeads(
  organizationId: string,
  q: { q?: string; niche?: string; city?: string; ownerId?: string; tagId?: string; sort: string; limit: number },
) {
  const digits = q.q?.replace(/\D/g, "") ?? "";
  const where: Prisma.LeadWhereInput = {
    organizationId,
    deletedAt: null,
    niche: q.niche || undefined,
    city: q.city ? { equals: q.city, mode: "insensitive" } : undefined,
    ownerId: q.ownerId,
    tags: q.tagId ? { some: { tagId: q.tagId } } : undefined,
    ...(q.q
      ? {
          OR: [
            { companyName: { contains: q.q, mode: "insensitive" } },
            { contactName: { contains: q.q, mode: "insensitive" } },
            ...(digits.length >= 4 ? [{ phoneE164: { contains: digits } }, { phone: { contains: q.q } }] : []),
          ],
        }
      : {}),
  };
  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    q.sort === "oldest"
      ? [{ createdAt: "asc" }]
      : q.sort === "score"
        ? [{ score: "desc" }]
        : q.sort === "lastContact"
          ? [{ lastContactAt: { sort: "desc", nulls: "last" } }]
          : [{ position: "asc" }, { createdAt: "desc" }];
  const leads = await prisma.lead.findMany({ where, orderBy, take: q.limit, select: leadCardSelect });
  return leads.map(toCard);
}

export async function getFilterOptions(organizationId: string) {
  const [niches, cities, members, tags] = await Promise.all([
    prisma.lead.findMany({ where: { organizationId, deletedAt: null, niche: { not: null } }, distinct: ["niche"], select: { niche: true }, orderBy: { niche: "asc" } }),
    prisma.lead.findMany({ where: { organizationId, deletedAt: null, city: { not: null } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    prisma.membership.findMany({ where: { organizationId }, select: { user: { select: { id: true, name: true } } } }),
    prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);
  return {
    niches: niches.map((n) => n.niche!),
    cities: cities.map((c) => c.city!),
    members: members.map((m) => m.user),
    tags,
  };
}

async function assertMember(organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
  if (!m) throw badRequest("Responsável não pertence à organização");
}

async function assertTags(organizationId: string, tagIds: string[] | undefined) {
  if (!tagIds?.length) return;
  const count = await prisma.tag.count({ where: { organizationId, id: { in: tagIds } } });
  if (count !== new Set(tagIds).size) throw badRequest("Etiqueta inválida");
}

export async function createLead(organizationId: string, actorId: string, input: LeadInput & { stageId?: string }) {
  const pipeline = await defaultPipeline(organizationId);
  const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages[0];
  if (!stage) throw badRequest("Etapa inválida");
  await assertMember(organizationId, input.ownerId);
  await assertTags(organizationId, input.tagIds);

  const phoneE164 = phoneToE164(input.phone);
  if (phoneE164) {
    const dup = await prisma.lead.findFirst({ where: { organizationId, phoneE164, deletedAt: null }, select: { companyName: true } });
    if (dup) throw conflict(`Já existe um lead com este telefone: ${dup.companyName}`);
  }
  const source = await prisma.leadSource.upsert({
    where: { organizationId_type_label: { organizationId, type: "MANUAL", label: "Cadastro manual" } },
    create: { organizationId, type: "MANUAL", label: "Cadastro manual" },
    update: {},
  });
  const top = await prisma.lead.aggregate({ where: { organizationId, stageId: stage.id }, _min: { position: true } });

  const { tagIds, ...data } = input;
  const lead = await prisma.lead.create({
    data: {
      ...data,
      stageId: stage.id,
      organizationId,
      pipelineId: pipeline.id,
      sourceId: source.id,
      phoneE164,
      websiteReported: input.website ? true : null,
      ownerId: input.ownerId ?? actorId,
      position: (top._min.position ?? 1) - 1,
      tags: tagIds?.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      activities: { create: { organizationId, actorId, type: "LEAD_CREATED", description: "Lead criado manualmente" } },
    },
    select: leadCardSelect,
  });
  return toCard(lead);
}

export async function getLead(organizationId: string, id: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      stage: { select: { id: true, key: true, name: true, color: true } },
      owner: { select: { id: true, name: true } },
      source: { select: { type: true, label: true } },
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      notes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, name: true } } } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { id: true, name: true } } } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], include: { assignee: { select: { id: true, name: true } } } },
    },
  });
  if (!lead) throw notFound("Lead não encontrado");
  return { ...lead, tags: lead.tags.map((t) => t.tag) };
}

export async function updateLead(organizationId: string, actorId: string, id: string, input: Partial<LeadInput>) {
  const lead = await prisma.lead.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!lead) throw notFound("Lead não encontrado");
  await assertMember(organizationId, input.ownerId);
  await assertTags(organizationId, input.tagIds);
  const { tagIds, ...data } = input;
  const phoneE164 = input.phone !== undefined ? phoneToE164(input.phone) : undefined;
  if (phoneE164 && phoneE164 !== lead.phoneE164) {
    const dup = await prisma.lead.findFirst({ where: { organizationId, phoneE164, deletedAt: null, id: { not: id } }, select: { companyName: true } });
    if (dup) throw conflict(`Já existe um lead com este telefone: ${dup.companyName}`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        ...data,
        ...(phoneE164 !== undefined ? { phoneE164 } : {}),
        ...(input.website !== undefined ? { websiteReported: input.website ? true : lead.websiteReported === true ? null : lead.websiteReported } : {}),
      },
    });
    if (tagIds) {
      await tx.leadTag.deleteMany({ where: { leadId: id } });
      if (tagIds.length) await tx.leadTag.createMany({ data: tagIds.map((tagId) => ({ leadId: id, tagId })) });
    }
    await tx.leadActivity.create({ data: { organizationId, leadId: id, actorId, type: "LEAD_UPDATED", description: "Dados do lead editados" } });
  });
  return getLead(organizationId, id);
}

/**
 * Move o card no Kanban. A posição é um float entre os vizinhos (sem renumerar a coluna inteira
 * a cada arraste); quando não sobra espaço entre dois vizinhos, a coluna é renumerada.
 */
export async function moveLead(organizationId: string, actorId: string, id: string, stageId: string, index: number) {
  const lead = await prisma.lead.findFirst({ where: { id, organizationId, deletedAt: null }, include: { stage: true } });
  if (!lead) throw notFound("Lead não encontrado");
  const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, organizationId, pipelineId: lead.pipelineId } });
  if (!stage) throw badRequest("Etapa inválida");

  return prisma.$transaction(async (tx) => {
    const siblings = await tx.lead.findMany({
      where: { organizationId, stageId, deletedAt: null, id: { not: id } },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      select: { id: true, position: true },
    });
    const i = Math.min(index, siblings.length);
    const before = siblings[i - 1]?.position;
    const after = siblings[i]?.position;
    let position =
      before === undefined && after === undefined ? 0 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2;

    if (before !== undefined && after !== undefined && after - before < 1e-6) {
      // Renumera a coluna para abrir espaço.
      const ordered = [...siblings.slice(0, i).map((s) => s.id), id, ...siblings.slice(i).map((s) => s.id)];
      for (const [n, leadId] of ordered.entries()) await tx.lead.update({ where: { id: leadId }, data: { position: n } });
      position = i;
    }

    const changed = lead.stageId !== stageId;
    await tx.lead.update({
      where: { id },
      data: {
        stageId,
        position,
        ...(changed && stage.kind === "WON" ? { convertedAt: new Date() } : {}),
        ...(changed && lead.stage.kind === "WON" && stage.kind !== "WON" ? { convertedAt: null } : {}),
      },
    });
    if (changed) {
      await tx.leadActivity.create({
        data: {
          organizationId,
          leadId: id,
          actorId,
          type: "STAGE_CHANGED",
          description: `Movido de ${lead.stage.name} para ${stage.name}`,
          metadata: { from: lead.stage.key, to: stage.key },
        },
      });
      const auto = STAGE_ACTIVITY[stage.key];
      if (auto) await tx.leadActivity.create({ data: { organizationId, leadId: id, actorId, type: auto.type, description: auto.text } });
    }
    return { id, stageId, position, changed };
  });
}

export async function deleteLead(organizationId: string, id: string) {
  const { count } = await prisma.lead.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (count === 0) throw notFound("Lead não encontrado");
}

export async function addNote(organizationId: string, actorId: string, leadId: string, body: string) {
  await getLead(organizationId, leadId);
  const note = await prisma.leadNote.create({ data: { organizationId, leadId, authorId: actorId, body } });
  await prisma.leadActivity.create({ data: { organizationId, leadId, actorId, type: "NOTE_ADDED", description: body.slice(0, 120) } });
  return note;
}

export async function deleteNote(organizationId: string, leadId: string, noteId: string) {
  const { count } = await prisma.leadNote.updateMany({ where: { id: noteId, leadId, organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (count === 0) throw notFound("Nota não encontrada");
}

const ACTIVITY_TEXT: Record<string, string> = {
  MESSAGE_SENT: "Contato realizado",
  REPLY_RECEIVED: "Resposta recebida",
  INTEREST_SHOWN: "Demonstrou interesse",
  MEETING_SCHEDULED: "Reunião agendada",
  PROPOSAL_SENT: "Proposta enviada",
};

/** Registro manual de contato (enquanto o WhatsApp não está integrado, ou para contatos por telefone). */
export async function logActivity(organizationId: string, actorId: string, leadId: string, type: keyof typeof ACTIVITY_TEXT, description?: string) {
  await getLead(organizationId, leadId);
  const contact = type === "MESSAGE_SENT" || type === "REPLY_RECEIVED";
  await prisma.$transaction([
    prisma.leadActivity.create({ data: { organizationId, leadId, actorId, type: type as ActivityType, description: description || ACTIVITY_TEXT[type]! } }),
    prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(contact ? { lastContactAt: new Date() } : {}),
        ...(type === "INTEREST_SHOWN" ? { interest: "HIGH" } : {}),
      },
    }),
  ]);
}

// ── Tarefas ──

export async function listTasks(organizationId: string, q: { leadId?: string; status?: "PENDING" | "DONE" | "CANCELED" }) {
  return prisma.task.findMany({
    where: { organizationId, leadId: q.leadId, status: q.status, OR: [{ leadId: null }, { lead: { deletedAt: null } }] },
    orderBy: { dueAt: "asc" },
    take: 300,
    include: { lead: { select: { id: true, companyName: true } }, assignee: { select: { id: true, name: true } } },
  });
}

export async function createTask(
  organizationId: string,
  actorId: string,
  input: { leadId?: string | null; type: Prisma.TaskCreateInput["type"]; title: string; description?: string | null; dueAt: Date; assigneeId?: string | null },
) {
  if (input.leadId) await getLead(organizationId, input.leadId);
  await assertMember(organizationId, input.assigneeId);
  const task = await prisma.task.create({
    data: { ...input, organizationId, createdById: actorId, assigneeId: input.assigneeId ?? actorId },
  });
  if (input.leadId) {
    await prisma.leadActivity.create({
      data: { organizationId, leadId: input.leadId, actorId, type: "TASK_CREATED", description: `Tarefa: ${input.title}`, metadata: { taskId: task.id } },
    });
  }
  return task;
}

export async function updateTask(organizationId: string, actorId: string, id: string, input: { status?: "PENDING" | "DONE" | "CANCELED"; dueAt?: Date; title?: string }) {
  const task = await prisma.task.findFirst({ where: { id, organizationId } });
  if (!task) throw notFound("Tarefa não encontrada");
  const updated = await prisma.task.update({
    where: { id },
    data: { ...input, completedAt: input.status === "DONE" ? new Date() : input.status ? null : undefined },
  });
  if (input.status === "DONE" && task.status !== "DONE" && task.leadId) {
    await prisma.leadActivity.create({
      data: { organizationId, leadId: task.leadId, actorId, type: "TASK_COMPLETED", description: `Concluída: ${task.title}` },
    });
  }
  return updated;
}

// ── Etiquetas ──

export async function createTag(organizationId: string, name: string, color: string) {
  try {
    return await prisma.tag.create({ data: { organizationId, name, color }, select: { id: true, name: true, color: true } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw conflict("Já existe uma etiqueta com este nome");
    throw err;
  }
}

// ── Resultados de busca → CRM ──

interface ResultData {
  name: string;
  niche: string | null;
  category: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  phoneE164: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUrl: string | null;
  fetchedAt: string;
}

/**
 * Cria leads a partir de resultados do Google Maps. Usado pelo Atlas e pela tela "Encontrar Leads".
 * Duplicidade é barrada por (organização, placeId), inclusive sob concorrência.
 */
export async function createLeadsFromResults(organizationId: string, results: SearchResult[], actorId: string | null, opts: { onProgress?: (done: number) => Promise<void> } = {}) {
  const pipeline = await defaultPipeline(organizationId);
  const stageNew = pipeline.stages.find((s) => s.key === "new")!;
  const stageQualified = pipeline.stages.find((s) => s.key === "qualified") ?? stageNew;
  const source = await prisma.leadSource.upsert({
    where: { organizationId_type_label: { organizationId, type: "GOOGLE_MAPS", label: "Google Maps" } },
    create: { organizationId, type: "GOOGLE_MAPS", label: "Google Maps" },
    update: {},
  });
  const top = await prisma.lead.aggregate({ where: { organizationId, stageId: stageNew.id }, _min: { position: true } });
  let position = (top._min.position ?? 0) - results.length - 1;

  let created = 0;
  let duplicates = 0;
  const createdIds: string[] = [];
  for (const [i, r] of results.entries()) {
    const d = r.data as unknown as ResultData & { score?: number; scoreReasons?: { points: number; reason: string }[] };
    const qualified = typeof d.score === "number" && d.score >= QUALIFIED_SCORE;
    const existing = await prisma.lead.findUnique({ where: { organizationId_placeId: { organizationId, placeId: r.placeId } }, select: { id: true } });
    if (existing) {
      duplicates++;
      if (!r.leadId) await prisma.searchResult.update({ where: { id: r.id }, data: { leadId: existing.id } });
    } else {
      try {
        const lead = await prisma.lead.create({
          data: {
            organizationId,
            pipelineId: pipeline.id,
            stageId: qualified ? stageQualified.id : stageNew.id,
            sourceId: source.id,
            ownerId: actorId,
            score: d.score ?? 0,
            scoreReasons: d.scoreReasons ?? [],
            companyName: d.name.slice(0, 200),
            niche: d.niche,
            category: d.category,
            address: d.address,
            neighborhood: d.neighborhood,
            city: d.city,
            state: d.state,
            country: "Brasil",
            phone: d.phone,
            phoneE164: d.phoneE164,
            website: d.website,
            websiteReported: d.website ? true : null,
            googleMapsUrl: d.googleMapsUrl,
            placeId: r.placeId,
            placeDataFetchedAt: new Date(d.fetchedAt),
            rating: d.rating,
            reviewCount: d.reviewCount,
            position: position++,
          },
        });
        await prisma.leadActivity.createMany({
          data: [
            { organizationId, leadId: lead.id, type: "LEAD_FOUND", description: "Encontrado no Google Maps", createdAt: r.createdAt, metadata: { searchJobId: r.searchJobId } },
            { organizationId, leadId: lead.id, actorId, type: "LEAD_CREATED", description: "Adicionado ao CRM" },
            ...(qualified ? [{ organizationId, leadId: lead.id, type: "QUALIFIED" as const, description: `Qualificado pelo Scout (score ${d.score})` }] : []),
          ],
        });
        await prisma.searchResult.update({ where: { id: r.id }, data: { leadId: lead.id } });
        createdIds.push(lead.id);
        created++;
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") duplicates++;
        else throw err;
      }
    }
    if (opts.onProgress && (i % 5 === 4 || i === results.length - 1)) await opts.onProgress(i + 1);
  }
  return { created, duplicates, createdIds };
}

export async function previewImport(organizationId: string, resultIds: string[]) {
  const results = await prisma.searchResult.findMany({ where: { organizationId, id: { in: resultIds } }, select: { id: true, placeId: true, name: true } });
  if (results.length !== new Set(resultIds).size) throw badRequest("Resultado inválido");
  const existing = await prisma.lead.findMany({
    where: { organizationId, placeId: { in: results.map((r) => r.placeId) } },
    select: { placeId: true, companyName: true, deletedAt: true },
  });
  const set = new Set(existing.map((e) => e.placeId));
  return {
    toAdd: results.filter((r) => !set.has(r.placeId)).length,
    alreadyInCrm: results.filter((r) => set.has(r.placeId)).map((r) => r.name),
  };
}

export async function importResults(organizationId: string, actorId: string, resultIds: string[]) {
  const results = await prisma.searchResult.findMany({ where: { organizationId, id: { in: resultIds } }, orderBy: { createdAt: "asc" } });
  if (results.length !== new Set(resultIds).size) throw badRequest("Resultado inválido");
  const { created, duplicates } = await createLeadsFromResults(organizationId, results, actorId);
  return { created, duplicates };
}

// ── Buscas (tela Encontrar Leads) ──

export async function listSearches(organizationId: string) {
  const jobs = await prisma.searchJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, status: true, params: true, requestedCount: true, foundCount: true, requestCount: true, createdAt: true, finishedAt: true },
  });
  return jobs;
}

export async function getSearchResults(organizationId: string, jobId: string, page: number, pageSize: number) {
  const job = await prisma.searchJob.findFirst({ where: { id: jobId, organizationId } });
  if (!job) throw notFound("Busca não encontrada");
  const [total, rows] = await Promise.all([
    prisma.searchResult.count({ where: { searchJobId: jobId } }),
    prisma.searchResult.findMany({
      where: { searchJobId: jobId },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { lead: { select: { id: true, deletedAt: true, score: true, stage: { select: { name: true } } } } },
    }),
  ]);
  // "Já no CRM" é checado na hora (o lead pode ter sido criado por outra busca).
  const placeIds = rows.map((r) => r.placeId);
  const inCrm = new Map(
    (await prisma.lead.findMany({ where: { organizationId, placeId: { in: placeIds }, deletedAt: null }, select: { id: true, placeId: true, score: true, stage: { select: { name: true } } } })).map((l) => [l.placeId, l]),
  );
  return {
    job: { id: job.id, status: job.status, params: job.params, foundCount: job.foundCount, requestCount: job.requestCount, createdAt: job.createdAt },
    total,
    page,
    pageSize,
    rows: rows.map((r) => {
      const lead = inCrm.get(r.placeId);
      return { id: r.id, placeId: r.placeId, ...(r.data as object), lead: lead ? { id: lead.id, score: lead.score, stage: lead.stage.name } : null };
    }),
  };
}

/** Política da Places API: conteúdo em cache por no máximo 30 dias. Resultados não importados expiram. */
export async function purgeExpiredSearchResults(days = 30) {
  const { count } = await prisma.searchResult.deleteMany({ where: { leadId: null, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  return count;
}
