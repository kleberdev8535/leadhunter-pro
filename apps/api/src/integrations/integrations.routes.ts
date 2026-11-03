import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { authOf, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NICHE_KEYS } from "../agents/niches.js";
import * as places from "./google-places/places.service.js";

const keyBody = z.object({ apiKey: z.string().trim().min(20, "Chave muito curta").max(200).regex(/^[A-Za-z0-9_-]+$/, "Formato de chave inválido") });
const prospectBody = z.object({
  dailySearchLimit: z.number().int().min(10).max(10_000),
  monthlyRequestBudget: z.number().int().min(10).max(100_000),
  favoriteNiches: z.array(z.enum(NICHE_KEYS)).max(17),
  dailyMessageLimit: z.number().int().min(1).max(500).optional(),
  messageIntervalSec: z.number().int().min(15).max(3600).optional(),
  maxUnansweredMessages: z.number().int().min(1).max(10).optional(),
  senderName: z.string().trim().max(80).nullable().optional(),
  serviceOffered: z.string().trim().max(300).nullable().optional(),
});

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get("/google-places", async (req, res) => {
  res.json(await places.getPlacesStatus(authOf(req).organizationId));
});

/** A chave entra, é criptografada e nunca mais sai: o GET devolve só os 4 últimos caracteres. */
integrationsRouter.put("/google-places", requireRole("OWNER", "ADMIN"), validate(keyBody), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await places.savePlacesKey(organizationId, req.body.apiKey);
  await audit({ action: "integration.google_places_saved", organizationId, userId, req });
  res.json(await places.getPlacesStatus(organizationId));
});

integrationsRouter.post("/google-places/test", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const { organizationId } = authOf(req);
  const result = await places.testPlacesKey(organizationId);
  res.json({ ...result, status: await places.getPlacesStatus(organizationId) });
});

integrationsRouter.delete("/google-places", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await places.removePlacesKey(organizationId);
  await audit({ action: "integration.google_places_removed", organizationId, userId, req });
  res.status(204).end();
});

integrationsRouter.get("/prospecting", async (req, res) => {
  const organizationId = authOf(req).organizationId;
  const s = await prisma.organizationSettings.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
  const profile = await prisma.aIConfiguration.findUnique({ where: { organizationId } });
  res.json({ dailySearchLimit: s.dailySearchLimit, monthlyRequestBudget: s.monthlyRequestBudget, favoriteNiches: s.favoriteNiches, dailyMessageLimit: s.dailyMessageLimit, messageIntervalSec: s.messageIntervalSec, maxUnansweredMessages: s.maxUnansweredMessages, senderName: profile?.senderName ?? null, serviceOffered: profile?.serviceOffered ?? null });
});

integrationsRouter.put("/prospecting", requireRole("OWNER", "ADMIN"), validate(prospectBody), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const { senderName, serviceOffered, ...limits } = req.body as { senderName?: string | null; serviceOffered?: string | null } & Record<string, unknown>;
  const s = await prisma.organizationSettings.upsert({ where: { organizationId }, create: { organizationId, ...limits }, update: limits });
  // Perfil comercial: quem assina e o que oferece (usado pelo Writer e pelo "Gerar mensagem").
  const profile = await prisma.aIConfiguration.upsert({
    where: { organizationId },
    create: { organizationId, model: "templates", senderName: senderName ?? null, serviceOffered: serviceOffered ?? null },
    update: { ...(senderName !== undefined ? { senderName } : {}), ...(serviceOffered !== undefined ? { serviceOffered } : {}) },
  });
  await audit({ action: "settings.prospecting_updated", organizationId, userId, req });
  res.json({ dailySearchLimit: s.dailySearchLimit, monthlyRequestBudget: s.monthlyRequestBudget, favoriteNiches: s.favoriteNiches, dailyMessageLimit: s.dailyMessageLimit, messageIntervalSec: s.messageIntervalSec, maxUnansweredMessages: s.maxUnansweredMessages, senderName: profile.senderName, serviceOffered: profile.serviceOffered });
});
