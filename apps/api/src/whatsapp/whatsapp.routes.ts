import { Router } from "express";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { authOf, requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { phoneToE164 } from "../modules/crm/crm.service.js";
import { badRequest } from "../lib/errors.js";
import * as wa from "./whatsapp.service.js";
import * as msgs from "./messages.service.js";
import { composeForLead } from "../agents/workers/writer.worker.js";
import { MESSAGE_KINDS } from "../tasks/task.schemas.js";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { PermanentError } from "../tasks/task.errors.js";

const id = z.object({ id: z.string().uuid() });
const leadParams = z.object({ leadId: z.string().uuid() });
const sendSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().trim().min(1, "Escreva a mensagem").max(1500, "Mensagem muito longa para uma abordagem"),
  idempotencyKey: z.string().trim().min(8).max(80),
  legalBasis: z.enum(["LEGITIMATE_INTEREST", "CONSENT"]).optional(),
});
const pauseSchema = z.object({ paused: z.boolean() });
const suppressSchema = z.object({ phone: z.string().trim().min(8).max(30), reason: z.string().trim().min(2).max(300) });

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

// ── Conexão ──
whatsappRouter.get("/status", async (req, res) => res.json(await wa.getStatus(authOf(req).organizationId)));

whatsappRouter.post("/connect", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await audit({ action: "whatsapp.connect", organizationId, userId, req });
  res.json(await wa.connect(organizationId));
});

whatsappRouter.post("/reconnect", requireRole("OWNER", "ADMIN"), async (req, res) => {
  res.json(await wa.reconnect(authOf(req).organizationId));
});

whatsappRouter.post("/disconnect", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await audit({ action: "whatsapp.disconnect", organizationId, userId, req });
  res.json(await wa.disconnect(organizationId));
});

// ── Mensagens ──
whatsappRouter.get("/usage", async (req, res) => res.json(await msgs.todayUsage(authOf(req).organizationId)));
whatsappRouter.get("/conversations", async (req, res) => res.json(await msgs.listConversations(authOf(req).organizationId)));

whatsappRouter.get("/conversations/:id", validate(id, "params"), async (req, res) => {
  res.json(await msgs.getMessages(authOf(req).organizationId, req.params.id as string));
});

whatsappRouter.post("/conversations/:id/pause", validate(id, "params"), validate(pauseSchema), async (req, res) => {
  res.json(await msgs.setConversationPaused(authOf(req).organizationId, req.params.id as string, req.body.paused));
});

whatsappRouter.get("/leads/:leadId/conversation", validate(leadParams, "params"), async (req, res) => {
  res.json({ conversation: await msgs.conversationForLead(authOf(req).organizationId, req.params.leadId as string) });
});

whatsappRouter.get("/leads/:leadId/drafts", validate(leadParams, "params"), async (req, res) => {
  res.json(await msgs.draftsForLead(authOf(req).organizationId, req.params.leadId as string));
});

whatsappRouter.post("/messages", validate(sendSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const { message, duplicate } = await msgs.queueMessage(organizationId, userId, req.body);
  if (!duplicate) await audit({ action: "whatsapp.message_queued", organizationId, userId, entity: "WhatsAppMessage", entityId: message.id, req });
  res.status(duplicate ? 200 : 201).json(message);
});

// ── Lista de bloqueio ──
whatsappRouter.get("/suppression", async (req, res) => res.json(await msgs.listSuppression(authOf(req).organizationId)));

whatsappRouter.post("/suppression", validate(suppressSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  const e164 = phoneToE164(req.body.phone);
  if (!e164) throw badRequest("Telefone inválido");
  await msgs.suppress(organizationId, userId, e164, req.body.reason, "manual");
  await audit({ action: "whatsapp.suppressed", organizationId, userId, metadata: { phone: e164 }, req });
  res.status(201).json({ ok: true });
});

whatsappRouter.delete("/suppression/:id", requireRole("OWNER", "ADMIN"), validate(id, "params"), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  await msgs.removeSuppression(organizationId, req.params.id as string);
  await audit({ action: "whatsapp.unsuppressed", organizationId, userId, entityId: req.params.id as string, req });
  res.status(204).end();
});

// ── Gerar mensagem (motor de templates do backend, sem IA externa) ──
const composeSchema = z.object({ leadId: z.string().uuid(), kind: z.enum(MESSAGE_KINDS) });
whatsappRouter.post("/compose", validate(composeSchema), async (req, res) => {
  try {
    res.json({ body: await composeForLead(authOf(req).organizationId, req.body.leadId, req.body.kind) });
  } catch (err) {
    if (err instanceof PermanentError) throw badRequest(err.message);
    throw err;
  }
});

// ── Templates salvos (usam {empresa}, {cidade}, {remetente}, {servico}) ──
const templateSchema = z.object({ name: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(1500) });
whatsappRouter.get("/templates", async (req, res) => {
  res.json(await prisma.messageTemplate.findMany({ where: { organizationId: authOf(req).organizationId, deletedAt: null }, orderBy: { updatedAt: "desc" } }));
});
whatsappRouter.post("/templates", validate(templateSchema), async (req, res) => {
  const { organizationId, userId } = authOf(req);
  res.status(201).json(await prisma.messageTemplate.create({ data: { ...req.body, organizationId, createdById: userId, kind: "CUSTOM" } }));
});
whatsappRouter.delete("/templates/:id", validate(id, "params"), async (req, res) => {
  const { count } = await prisma.messageTemplate.updateMany({ where: { id: req.params.id as string, organizationId: authOf(req).organizationId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!count) throw notFound();
  res.status(204).end();
});
