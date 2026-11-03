import { prisma } from "../../lib/prisma.js";
import { credentialHint, decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { PermanentError } from "../../tasks/task.errors.js";
import { testKey, type FetchFn } from "./places.client.js";

const PROVIDER = "GOOGLE_PLACES" as const;

const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** A chave só é decifrada aqui, no backend, no momento do uso. */
export async function getPlacesKey(organizationId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: PROVIDER } },
  });
  if (!integration?.encryptedCredentials) {
    throw new PermanentError("Google Maps não configurado. Cadastre a API Key em Configurações → Google Maps.");
  }
  return decryptSecret(integration.encryptedCredentials);
}

export async function savePlacesKey(organizationId: string, apiKey: string) {
  return prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: PROVIDER } },
    create: {
      organizationId,
      provider: PROVIDER,
      status: "CONFIGURED",
      encryptedCredentials: encryptSecret(apiKey),
      credentialHint: credentialHint(apiKey),
    },
    update: {
      status: "CONFIGURED",
      encryptedCredentials: encryptSecret(apiKey),
      credentialHint: credentialHint(apiKey),
      lastError: null,
    },
  });
}

export async function removePlacesKey(organizationId: string) {
  await prisma.integration.deleteMany({ where: { organizationId, provider: PROVIDER } });
}

export async function testPlacesKey(organizationId: string, fetchFn?: FetchFn) {
  const key = await getPlacesKey(organizationId);
  try {
    await testKey(key, fetchFn);
    await recordUsage(organizationId, 1, 0, 0);
    await prisma.integration.update({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
      data: { status: "VALID", lastCheckedAt: new Date(), lastError: null },
    });
    return { ok: true as const };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await prisma.integration.update({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
      data: { status: "INVALID", lastCheckedAt: new Date(), lastError: message },
    });
    return { ok: false as const, error: message };
  }
}

export async function recordUsage(organizationId: string, requests: number, units: number, costMicros: number) {
  await prisma.integrationUsage.upsert({
    where: { organizationId_provider_day: { organizationId, provider: PROVIDER, day: todayUtc() } },
    create: { organizationId, provider: PROVIDER, day: todayUtc(), requests, units, estimatedCostMicros: BigInt(costMicros) },
    update: {
      requests: { increment: requests },
      units: { increment: units },
      estimatedCostMicros: { increment: BigInt(costMicros) },
    },
  });
}

export async function getUsage(organizationId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, month, settings] = await Promise.all([
    prisma.integrationUsage.findUnique({
      where: { organizationId_provider_day: { organizationId, provider: PROVIDER, day: todayUtc() } },
    }),
    prisma.integrationUsage.aggregate({
      where: { organizationId, provider: PROVIDER, day: { gte: monthStart } },
      _sum: { requests: true, units: true, estimatedCostMicros: true },
    }),
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
  ]);
  return {
    today: { requests: today?.requests ?? 0, places: today?.units ?? 0 },
    month: {
      requests: month._sum.requests ?? 0,
      places: month._sum.units ?? 0,
      estimatedCostUsd: Number(month._sum.estimatedCostMicros ?? 0n) / 1_000_000,
    },
    limits: {
      dailyPlaces: settings?.dailySearchLimit ?? 500,
      monthlyRequests: settings?.monthlyRequestBudget ?? 2000,
    },
  };
}

/** Controle de custo: barra a requisição antes de gastar, não depois. */
export async function assertBudget(organizationId: string, extraPlaces: number) {
  const usage = await getUsage(organizationId);
  if (usage.month.requests + 1 > usage.limits.monthlyRequests) {
    throw new PermanentError(
      `Limite mensal de ${usage.limits.monthlyRequests} requisições ao Google atingido. Ajuste em Configurações → Prospecção.`,
    );
  }
  if (usage.today.places + extraPlaces > usage.limits.dailyPlaces + 20) {
    throw new PermanentError(`Limite diário de ${usage.limits.dailyPlaces} lugares atingido. Tente amanhã ou ajuste o limite.`);
  }
}

export async function getPlacesStatus(organizationId: string) {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: PROVIDER } },
    select: { status: true, credentialHint: true, lastCheckedAt: true, lastError: true, updatedAt: true },
  });
  return {
    configured: !!integration,
    status: integration?.status ?? "NOT_CONFIGURED",
    credentialHint: integration?.credentialHint ?? null,
    lastCheckedAt: integration?.lastCheckedAt ?? null,
    lastError: integration?.lastError ?? null,
    usage: await getUsage(organizationId),
  };
}
