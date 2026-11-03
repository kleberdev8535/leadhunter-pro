import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { PermanentError } from "../../tasks/task.errors.js";
import type { TaskContext } from "../../tasks/task-context.js";
import { importToCrmParams, qualifyLeadsParams } from "../../tasks/task.schemas.js";
import { scoreLead } from "./scoring.js";
import { createLeadsFromResults } from "../../modules/crm/crm.service.js";
import { nicheByKey } from "../niches.js";

async function searchJobOf(organizationId: string, searchTaskId: string) {
  const task = await prisma.agentTask.findFirst({ where: { id: searchTaskId, organizationId, taskType: "SEARCH_LEADS", status: "COMPLETED" } });
  const jobId = (task?.result as { searchJobId?: string } | null)?.searchJobId;
  if (!jobId) throw new PermanentError("A busca de origem não tem resultados salvos");
  return jobId;
}

/** AtlasWorker → IMPORT_TO_CRM: cria leads a partir de uma busca, sem duplicar (unique org+placeId). */
export async function importToCrm(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const p = importToCrmParams.parse(ctx.task.parameters);
  const org = ctx.organizationId;
  const jobId = await searchJobOf(org, p.searchTaskId);

  const pipeline = await prisma.pipeline.findFirst({ where: { organizationId: org, isDefault: true }, include: { stages: true } });
  const stageNew = pipeline?.stages.find((s) => s.key === "new");
  const stageQualified = pipeline?.stages.find((s) => s.key === "qualified");
  if (!pipeline || !stageNew || !stageQualified) throw new PermanentError("Funil padrão não encontrado");
  const all = await prisma.searchResult.findMany({ where: { searchJobId: jobId, organizationId: org }, orderBy: { createdAt: "asc" } });
  const results = all.filter((r) => {
    const d = r.data as { website?: string | null; score?: number };
    if (p.onlyWithoutWebsite && d.website) return false;
    // Resultado sem score (Scout não rodou) entra; com score, só se atingir o mínimo.
    if (p.minScore !== undefined && typeof d.score === "number" && d.score < p.minScore) return false;
    return true;
  });
  const skipped = all.length - results.length;
  const { created, duplicates } = await createLeadsFromResults(org, results, ctx.task.createdById, {
    onProgress: (done) => ctx.progress((done / Math.max(1, results.length)) * 90),
  });

  let moved = 0;
  if (p.moveQualifiedMinScore !== undefined) {
    const toMove = await prisma.lead.findMany({
      where: { organizationId: org, stageId: stageNew.id, deletedAt: null, score: { gte: p.moveQualifiedMinScore }, searchResults: { some: { searchJobId: jobId } } },
      select: { id: true },
    });
    for (const l of toMove) {
      await prisma.lead.update({ where: { id: l.id }, data: { stageId: stageQualified.id } });
      await prisma.leadActivity.create({
        data: { organizationId: org, leadId: l.id, type: "STAGE_CHANGED", description: "Movido para Lead qualificado pelo Atlas", metadata: { from: "new", to: "qualified" } },
      });
    }
    moved = toMove.length;
  }

  await ctx.log(`${created} leads criados, ${duplicates} já existiam, ${skipped} ignorados pelo filtro, ${moved} movidos para qualificado`);
  return { created, duplicates, skipped, movedToQualified: moved, total: results.length };
}

/** ScoutWorker → QUALIFY_LEADS: pontuação por regras transparentes. */
export async function qualifyLeads(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const p = qualifyLeadsParams.parse(ctx.task.parameters);
  const org = ctx.organizationId;
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: org } });
  const config = { favoriteNiches: (settings?.favoriteNiches ?? []).map((k) => nicheByKey(k)?.label ?? k), targetCities: p.targetCities };

  if (p.source.kind === "search") {
    // Qualifica o que o Hunter encontrou ANTES de ir para o CRM: o Atlas usa este score para decidir o registro.
    const jobId = await searchJobOf(org, p.source.searchTaskId);
    const results = await prisma.searchResult.findMany({ where: { searchJobId: jobId, organizationId: org } });
    if (results.length === 0) {
      await ctx.log("A busca não trouxe empresas para qualificar.", "warn");
      return { evaluated: 0, high: 0, medium: 0, low: 0 };
    }
    const tiers = { alto: 0, médio: 0, baixo: 0 };
    for (const [i, r] of results.entries()) {
      const d = r.data as Record<string, unknown>;
      const s = scoreLead(
        {
          website: (d.website as string | null) ?? null,
          websiteReported: null,
          phoneE164: (d.phoneE164 as string | null) ?? null,
          phone: (d.phone as string | null) ?? null,
          niche: (d.niche as string | null) ?? null,
          city: (d.city as string | null) ?? null,
          rating: (d.rating as number | null) ?? null,
          reviewCount: (d.reviewCount as number | null) ?? null,
          replied: false,
          interested: false,
        },
        config,
      );
      tiers[s.tier]++;
      await prisma.searchResult.update({
        where: { id: r.id },
        data: { data: { ...d, score: s.score, scoreReasons: s.reasons, tier: s.tier } as Prisma.InputJsonValue },
      });
      if (i % 10 === 9 || i === results.length - 1) await ctx.progress(((i + 1) / results.length) * 100);
    }
    await ctx.log(`${results.length} empresas avaliadas: ${tiers.alto} alto, ${tiers["médio"]} médio, ${tiers.baixo} baixo potencial`);
    return { evaluated: results.length, high: tiers.alto, medium: tiers["médio"], low: tiers.baixo };
  }

  const where: Prisma.LeadWhereInput = { organizationId: org, deletedAt: null, stage: { key: p.source.stageKey } };

  const leads = await prisma.lead.findMany({
    where,
    take: p.limit,
    include: { activities: { where: { type: { in: ["REPLY_RECEIVED", "INTEREST_SHOWN"] } }, select: { type: true } } },
  });
  if (leads.length === 0) {
    await ctx.log("Nenhum lead nesta etapa.", "warn");
    return { evaluated: 0, high: 0, medium: 0, low: 0 };
  }

  const tiers = { alto: 0, médio: 0, baixo: 0 };
  for (const [i, lead] of leads.entries()) {
    const r = scoreLead(
      { ...lead, replied: lead.activities.some((a) => a.type === "REPLY_RECEIVED"), interested: lead.activities.some((a) => a.type === "INTEREST_SHOWN") },
      config,
    );
    tiers[r.tier]++;
    await prisma.lead.update({ where: { id: lead.id }, data: { score: r.score, scoreReasons: r.reasons } });
    if (r.tier === "alto" && lead.score < 60) {
      await prisma.leadActivity.create({
        data: { organizationId: org, leadId: lead.id, type: "QUALIFIED", description: `Qualificado pelo Scout (score ${r.score})`, metadata: { reasons: r.reasons } },
      });
    }
    if (i % 10 === 9 || i === leads.length - 1) await ctx.progress(((i + 1) / leads.length) * 100);
  }
  await ctx.log(`${leads.length} leads avaliados: ${tiers.alto} alto, ${tiers["médio"]} médio, ${tiers.baixo} baixo potencial`);
  return { evaluated: leads.length, high: tiers.alto, medium: tiers["médio"], low: tiers.baixo };
}
