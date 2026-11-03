import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { PermanentError } from "../../tasks/task.errors.js";
import type { TaskContext } from "../../tasks/task-context.js";
import { searchLeadsParams, updateLeadsParams } from "../../tasks/task.schemas.js";
import {
  DETAILS_COST_MICROS,
  MAX_RESULTS_PER_QUERY,
  TEXT_SEARCH_COST_MICROS,
  component,
  getPlace,
  searchText,
  toE164,
  type Place,
} from "../../integrations/google-places/places.client.js";
import { assertBudget, getPlacesKey, recordUsage } from "../../integrations/google-places/places.service.js";
import { nicheByKey } from "../niches.js";

interface Checkpoint {
  queryIndex?: number;
  pageToken?: string | null;
  searchJobId?: string;
  requests?: number;
}

/** Dados guardados por resultado. Seguem a política de cache da Places API (o placeId é permanente). */
function toResultData(place: Place, nicheLabel: string, alreadyInCrm: boolean) {
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "Sem nome",
    niche: nicheLabel,
    category: place.primaryTypeDisplayName?.text ?? null,
    address: place.formattedAddress ?? null,
    neighborhood: component(place, "sublocality_level_1") ?? component(place, "sublocality") ?? null,
    city: component(place, "administrative_area_level_2") ?? null,
    state: component(place, "administrative_area_level_1") ?? null,
    phone: place.nationalPhoneNumber ?? null,
    phoneE164: toE164(place) ?? null,
    website: place.websiteUri ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    googleMapsUrl: place.googleMapsUri ?? null,
    businessStatus: place.businessStatus ?? null,
    alreadyInCrm,
    fetchedAt: new Date().toISOString(),
  };
}

/** HunterWorker → SEARCH_LEADS: busca real na Google Places API (New), com filtros e deduplicação. */
export async function huntLeads(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const p = searchLeadsParams.parse(ctx.task.parameters);
  const apiKey = await getPlacesKey(ctx.organizationId);
  const cp = (ctx.task.checkpoint ?? {}) as Checkpoint;

  const location = [p.neighborhood, `${p.city} - ${p.state}`, p.country].filter(Boolean).join(", ");
  const queries: { label: string; text: string }[] = p.niches.map((key) => {
    const n = nicheByKey(key)!;
    return { label: n.label, text: `${n.query} em ${location}` };
  });
  if (p.customNiche) queries.push({ label: p.customNiche, text: `${p.customNiche} em ${location}` });

  const job =
    (cp.searchJobId && (await prisma.searchJob.findUnique({ where: { id: cp.searchJobId } }))) ||
    (await prisma.searchJob.create({
      data: {
        organizationId: ctx.organizationId,
        createdById: ctx.task.createdById,
        status: "RUNNING",
        params: p as Prisma.InputJsonValue,
        requestedCount: p.quantity,
        startedAt: new Date(),
      },
    }));

  const maxPossible = queries.length * MAX_RESULTS_PER_QUERY;
  if (p.quantity > maxPossible) {
    await ctx.log(`O Google devolve no máximo ${MAX_RESULTS_PER_QUERY} lugares por consulta; com ${queries.length} nicho(s) o teto é ${maxPossible}.`, "warn");
  }

  let saved = await prisma.searchResult.count({ where: { searchJobId: job.id } });
  let requests = cp.requests ?? 0;
  let scanned = 0;
  let skippedByFilter = 0;
  const perQueryTarget = Math.ceil(p.quantity / queries.length);

  for (let qi = cp.queryIndex ?? 0; qi < queries.length && saved < p.quantity; qi++) {
    const q = queries[qi]!;
    let pageToken: string | undefined = qi === cp.queryIndex ? (cp.pageToken ?? undefined) : undefined;
    let fromThisQuery = 0;
    await ctx.log(`Buscando "${q.text}"`);

    do {
      await assertBudget(ctx.organizationId, 20);
      const page = await searchText(apiKey, q.text, pageToken, ctx.deps.fetch);
      requests++;
      scanned += page.places.length;
      await recordUsage(ctx.organizationId, 1, page.places.length, TEXT_SEARCH_COST_MICROS);

      const ids = page.places.map((pl) => pl.id);
      const inCrm = new Set(
        (await prisma.lead.findMany({ where: { organizationId: ctx.organizationId, placeId: { in: ids } }, select: { placeId: true } })).map(
          (l) => l.placeId,
        ),
      );

      for (const place of page.places) {
        if (saved >= p.quantity) break;
        const already = inCrm.has(place.id);
        const passes =
          place.businessStatus !== "CLOSED_PERMANENTLY" &&
          (p.website === "any" || (p.website === "with" ? !!place.websiteUri : !place.websiteUri)) &&
          (!p.requirePhone || !!(place.nationalPhoneNumber || place.internationalPhoneNumber)) &&
          (p.minRating === undefined || (place.rating ?? 0) >= p.minRating) &&
          (p.minReviews === undefined || (place.userRatingCount ?? 0) >= p.minReviews) &&
          (!p.onlyNotInCrm || !already);
        if (!passes) {
          skippedByFilter++;
          continue;
        }
        // unique(searchJobId, placeId): o mesmo lugar em dois nichos conta uma vez só.
        const created = await prisma.searchResult.createMany({
          data: [{
            organizationId: ctx.organizationId,
            searchJobId: job.id,
            placeId: place.id,
            name: (place.displayName?.text ?? "Sem nome").slice(0, 200),
            data: toResultData(place, q.label, already),
          }],
          skipDuplicates: true,
        });
        saved += created.count;
        fromThisQuery += created.count;
      }

      pageToken = page.nextPageToken;
      await prisma.searchJob.update({
        where: { id: job.id },
        data: { foundCount: saved, requestCount: requests, estimatedCostMicros: BigInt(requests * TEXT_SEARCH_COST_MICROS) },
      });
      await ctx.progress((saved / p.quantity) * 100, { queryIndex: qi, pageToken: pageToken ?? null, searchJobId: job.id, requests });
    } while (pageToken && saved < p.quantity && fromThisQuery < perQueryTarget * 2);
  }

  const status = saved < p.quantity ? "PARTIAL" : "COMPLETED";
  await prisma.searchJob.update({ where: { id: job.id }, data: { status, finishedAt: new Date() } });
  await ctx.log(`${saved} lugares salvos de ${scanned} analisados (${skippedByFilter} fora dos filtros), ${requests} requisições`);

  return {
    searchJobId: job.id,
    requested: p.quantity,
    saved,
    scanned,
    skippedByFilter,
    requests,
    estimatedCostUsd: (requests * TEXT_SEARCH_COST_MICROS) / 1_000_000,
    complete: status === "COMPLETED",
    note:
      saved < p.quantity
        ? "O Google não retornou lugares suficientes que atendam aos filtros nesta região."
        : "Sem site = o Google não informou site; isso não garante que a empresa não tenha um.",
  };
}

/** HunterWorker → UPDATE_LEADS: atualiza dados de leads com placeId (política de cache de 30 dias). */
export async function refreshLeads(ctx: TaskContext): Promise<Prisma.InputJsonValue> {
  const p = updateLeadsParams.parse(ctx.task.parameters);
  const apiKey = await getPlacesKey(ctx.organizationId);
  const cutoff = new Date(Date.now() - p.olderThanDays * 86_400_000);
  const leads = await prisma.lead.findMany({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      placeId: { not: null },
      OR: [{ placeDataFetchedAt: null }, { placeDataFetchedAt: { lt: cutoff } }],
    },
    take: p.limit,
    orderBy: { placeDataFetchedAt: { sort: "asc", nulls: "first" } },
  });
  if (leads.length === 0) return { updated: 0, note: "Nenhum lead precisava de atualização." };

  let updated = 0;
  let closed = 0;
  for (const [i, lead] of leads.entries()) {
    await assertBudget(ctx.organizationId, 1);
    try {
      const place = await getPlace(apiKey, lead.placeId!, ctx.deps.fetch);
      await recordUsage(ctx.organizationId, 1, 1, DETAILS_COST_MICROS);
      if (place.businessStatus === "CLOSED_PERMANENTLY") closed++;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          phone: place.nationalPhoneNumber ?? lead.phone,
          phoneE164: toE164(place) ?? lead.phoneE164,
          website: place.websiteUri ?? null,
          websiteReported: place.websiteUri ? true : null,
          rating: place.rating ?? lead.rating,
          reviewCount: place.userRatingCount ?? lead.reviewCount,
          googleMapsUrl: place.googleMapsUri ?? lead.googleMapsUrl,
          placeDataFetchedAt: new Date(),
        },
      });
      await prisma.leadActivity.create({
        data: { organizationId: ctx.organizationId, leadId: lead.id, type: "LEAD_UPDATED", description: "Dados atualizados pelo Hunter (Google Maps)" },
      });
      updated++;
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      await ctx.log(`Falha ao atualizar ${lead.companyName}: ${(err as Error).message}`, "warn");
    }
    await ctx.progress(((i + 1) / leads.length) * 100);
  }
  return { updated, checked: leads.length, closedPermanently: closed };
}
