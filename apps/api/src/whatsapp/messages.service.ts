import type { WhatsAppMessage } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { officeEvents } from "../office/events/office-events.js";
import type { InboundMessage } from "./provider.js";

/** Pedidos de descadastro reconhecidos automaticamente (resposta curta e explícita). */
const OPT_OUT = /^\s*(sair|parar|pare|stop|cancelar|descadastrar|remover|n[aã]o quero( mais)?( receber)?|n[aã]o tenho interesse|me tira( da lista)?|n[aã]o me (mande|envie) mais)\b/i;
export const isOptOut = (text: string) => OPT_OUT.test(text.trim());

const TZ = "America/Sao_Paulo";
/** Meia-noite de hoje no fuso de Brasília, como Date em UTC. */
function startOfLocalDay(now = new Date()) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

export function serializeMessage(m: WhatsAppMessage) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    body: m.body,
    status: m.status,
    error: m.error,
    sendAfter: m.sendAfter,
    sentAt: m.sentAt,
    createdAt: m.createdAt,
  };
}

async function settings(organizationId: string) {
  return prisma.organizationSettings.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
}

export interface QueueInput {
  leadId: string;
  body: string;
  idempotencyKey: string;
  legalBasis?: "LEGITIMATE_INTEREST" | "CONSENT";
}

/**
 * Coloca uma mensagem individual na fila de envio, aplicando todas as travas de volume e de respeito
 * ao contato. Não existe envio em massa: cada chamada é um lead, revisado pelo usuário.
 */
export async function queueMessage(organizationId: string, userId: string, input: QueueInput) {
  const existing = await prisma.whatsAppMessage.findUnique({ where: { idempotencyKey: `${organizationId}:${input.idempotencyKey}` } });
  if (existing) return { message: serializeMessage(existing), duplicate: true };

  const conn = await prisma.whatsAppConnection.findFirst({ where: { organizationId, provider: "WHATSAPP_QR" } });
  if (conn?.status !== "CONNECTED") throw new AppError(409, "WHATSAPP_DISCONNECTED", "Conecte o WhatsApp antes de enviar mensagens.");

  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId, deletedAt: null } });
  if (!lead) throw notFound("Lead não encontrado");
  if (!lead.phoneE164) throw badRequest("Este lead não tem um telefone válido para WhatsApp.");

  const blocked = await prisma.suppressionList.findUnique({ where: { organizationId_phoneE164: { organizationId, phoneE164: lead.phoneE164 } } });
  if (blocked) throw new AppError(409, "SUPPRESSED", `Este contato pediu para não receber mensagens (${blocked.reason}).`);

  if (lead.consentBasis === "NONE") {
    if (!input.legalBasis) {
      throw new AppError(409, "LEGAL_BASIS_REQUIRED", "Primeiro contato: confirme a base legal para falar com esta empresa.");
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { consentBasis: input.legalBasis } });
  }

  const cfg = await settings(organizationId);
  const today = await prisma.whatsAppMessage.count({
    where: { organizationId, direction: "OUTBOUND", status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] }, createdAt: { gte: startOfLocalDay() } },
  });
  if (today >= cfg.dailyMessageLimit) {
    throw new AppError(429, "DAILY_LIMIT", `Limite diário de ${cfg.dailyMessageLimit} mensagens atingido. Ajuste em Configurações → Prospecção.`);
  }

  const conversation = await prisma.whatsAppConversation.upsert({
    where: { connectionId_contactPhone: { connectionId: conn.id, contactPhone: lead.phoneE164 } },
    create: { organizationId, connectionId: conn.id, contactPhone: lead.phoneE164, leadId: lead.id },
    update: { leadId: lead.id },
  });
  if (conversation.sequencePaused) {
    throw new AppError(409, "SEQUENCE_PAUSED", "As mensagens para este contato estão interrompidas. Retome a conversa para enviar.");
  }

  // Mensagens seguidas sem resposta: protege o contato (e o número) de insistência.
  const recent = await prisma.whatsAppMessage.findMany({
    where: { conversationId: conversation.id, status: { notIn: ["FAILED", "DRAFT"] } },
    orderBy: { createdAt: "desc" },
    take: cfg.maxUnansweredMessages,
    select: { direction: true },
  });
  if (recent.length >= cfg.maxUnansweredMessages && recent.every((m) => m.direction === "OUTBOUND")) {
    throw new AppError(409, "TOO_MANY_UNANSWERED", `Já são ${cfg.maxUnansweredMessages} mensagens sem resposta para este contato. Aguarde um retorno.`);
  }

  const body = input.body.trim();
  const dup = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conversation.id, direction: "OUTBOUND", body, status: { notIn: ["FAILED"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
  });
  if (dup) throw new AppError(409, "DUPLICATE_MESSAGE", "Esta mesma mensagem já foi enviada para este contato nos últimos 7 dias.");

  // Fila: a próxima mensagem da organização só sai depois do intervalo mínimo.
  const last = await prisma.whatsAppMessage.findFirst({
    where: { organizationId, direction: "OUTBOUND", status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] } },
    orderBy: [{ sendAfter: { sort: "desc", nulls: "last" } }],
    select: { sendAfter: true, sentAt: true },
  });
  const lastAt = Math.max(last?.sendAfter?.getTime() ?? 0, last?.sentAt?.getTime() ?? 0);
  const sendAfter = new Date(Math.max(Date.now(), lastAt + cfg.messageIntervalSec * 1000));

  const message = await prisma.whatsAppMessage.create({
    data: {
      organizationId,
      conversationId: conversation.id,
      sentById: userId,
      direction: "OUTBOUND",
      body,
      status: "QUEUED",
      sendAfter,
      idempotencyKey: `${organizationId}:${input.idempotencyKey}`,
    },
  });
  officeEvents.publish(organizationId, "message:new", { message: serializeMessage(message), conversationId: conversation.id });
  return { message: serializeMessage(message), duplicate: false };
}

type Sender = (organizationId: string) => Promise<{ provider: { sendText(to: string, body: string): Promise<string> } }>;

/** Despachante: envia, uma por vez, as mensagens cujo horário chegou. */
export async function dispatchDue(getProvider: Sender) {
  const due = await prisma.whatsAppMessage.findMany({
    where: { status: "QUEUED", direction: "OUTBOUND", sendAfter: { lte: new Date() } },
    orderBy: { sendAfter: "asc" },
    take: 10,
    include: { conversation: true },
  });
  for (const m of due) {
    // Trava otimista: só quem muda QUEUED → SENT (via updateMany) envia; evita envio duplo.
    const claimed = await prisma.whatsAppMessage.updateMany({ where: { id: m.id, status: "QUEUED" }, data: { status: "DRAFT" } });
    if (claimed.count === 0) continue;
    try {
      if (m.conversation.sequencePaused) throw new Error("Sequência interrompida antes do envio");
      const blocked = await prisma.suppressionList.findUnique({ where: { organizationId_phoneE164: { organizationId: m.organizationId, phoneE164: m.conversation.contactPhone } } });
      if (blocked) throw new Error("Contato entrou na lista de bloqueio antes do envio");
      const { provider } = await getProvider(m.organizationId);
      const externalId = await provider.sendText(m.conversation.contactPhone, m.body);
      const sent = await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { status: "SENT", externalId, sentAt: new Date() } });
      await prisma.whatsAppConversation.update({ where: { id: m.conversationId }, data: { lastMessageAt: new Date() } });
      if (m.conversation.leadId) {
        await prisma.$transaction([
          prisma.leadActivity.create({
            data: { organizationId: m.organizationId, leadId: m.conversation.leadId, actorId: m.sentById, type: "MESSAGE_SENT", description: "Mensagem enviada pelo WhatsApp", metadata: { messageId: m.id } },
          }),
          prisma.lead.update({ where: { id: m.conversation.leadId }, data: { lastContactAt: new Date() } }),
        ]);
      }
      officeEvents.publish(m.organizationId, "message:updated", { message: serializeMessage(sent), conversationId: m.conversationId });
    } catch (err) {
      const failed = await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { status: "FAILED", error: (err as Error).message.slice(0, 500) } });
      officeEvents.publish(m.organizationId, "message:updated", { message: serializeMessage(failed), conversationId: m.conversationId });
      logger.warn({ err: (err as Error).message, messageId: m.id }, "falha no envio de WhatsApp");
    }
  }
}

/**
 * Mensagem recebida. Por privacidade, só guarda conversas com leads do CRM ou conversas já abertas
 * pelo sistema; chats pessoais do número conectado não são armazenados.
 */
export async function handleInbound(organizationId: string, connectionId: string, msg: InboundMessage) {
  const phone = msg.fromE164;
  if (!phone) return;
  let conversation = await prisma.whatsAppConversation.findUnique({ where: { connectionId_contactPhone: { connectionId, contactPhone: phone } } });
  const lead = conversation?.leadId
    ? await prisma.lead.findFirst({ where: { id: conversation.leadId, deletedAt: null } })
    : await prisma.lead.findFirst({ where: { organizationId, phoneE164: phone, deletedAt: null } });
  if (!conversation && !lead) return;
  conversation ??= await prisma.whatsAppConversation.create({ data: { organizationId, connectionId, contactPhone: phone, leadId: lead?.id } });

  let message;
  try {
    message = await prisma.whatsAppMessage.create({
      data: { organizationId, conversationId: conversation.id, direction: "INBOUND", body: msg.body.slice(0, 4096), status: "RECEIVED", externalId: msg.externalId, sentAt: msg.timestamp },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return; // já registrada
    throw err;
  }
  await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: msg.timestamp, lastInboundAt: msg.timestamp, unreadCount: { increment: 1 } },
  });
  if (lead) {
    await prisma.$transaction([
      prisma.leadActivity.create({ data: { organizationId, leadId: lead.id, type: "REPLY_RECEIVED", description: "Resposta recebida no WhatsApp", metadata: { messageId: message.id } } }),
      prisma.lead.update({ where: { id: lead.id }, data: { lastContactAt: msg.timestamp } }),
    ]);
  }

  if (isOptOut(msg.body)) {
    await suppress(organizationId, null, phone, "Pediu para não receber mensagens (resposta automática detectada)", "opt_out");
    if (lead) {
      await prisma.leadActivity.create({ data: { organizationId, leadId: lead.id, type: "LEAD_UPDATED", description: "Pediu para não receber mensagens — contato bloqueado" } });
    }
  }
  officeEvents.publish(organizationId, "message:new", { message: serializeMessage(message), conversationId: conversation.id });
}

export async function handleDelivery(organizationId: string, u: { externalId: string; status: "DELIVERED" | "READ" | "FAILED" }) {
  const m = await prisma.whatsAppMessage.findFirst({ where: { externalId: u.externalId, organizationId } });
  if (!m || m.status === "READ") return;
  const updated = await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { status: u.status } });
  officeEvents.publish(organizationId, "message:updated", { message: serializeMessage(updated), conversationId: m.conversationId });
}

/** Lista de bloqueio: interrompe a conversa e cancela o que estiver na fila. */
export async function suppress(organizationId: string, userId: string | null, phoneE164: string, reason: string, source: string) {
  await prisma.suppressionList.upsert({
    where: { organizationId_phoneE164: { organizationId, phoneE164 } },
    create: { organizationId, phoneE164, reason, source, createdById: userId },
    update: {},
  });
  const convs = await prisma.whatsAppConversation.findMany({ where: { organizationId, contactPhone: phoneE164 }, select: { id: true } });
  await prisma.whatsAppConversation.updateMany({ where: { organizationId, contactPhone: phoneE164 }, data: { sequencePaused: true } });
  await prisma.whatsAppMessage.updateMany({
    where: { conversationId: { in: convs.map((c) => c.id) }, status: "QUEUED" },
    data: { status: "FAILED", error: "Cancelada: contato na lista de bloqueio" },
  });
}

export async function setConversationPaused(organizationId: string, conversationId: string, paused: boolean) {
  const conv = await prisma.whatsAppConversation.findFirst({ where: { id: conversationId, organizationId } });
  if (!conv) throw notFound("Conversa não encontrada");
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { sequencePaused: paused } });
  if (paused) {
    await prisma.whatsAppMessage.updateMany({ where: { conversationId, status: "QUEUED" }, data: { status: "FAILED", error: "Cancelada: sequência interrompida" } });
  }
  return { paused };
}

export async function listConversations(organizationId: string) {
  const convs = await prisma.whatsAppConversation.findMany({
    where: { organizationId },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 200,
    include: {
      lead: { select: { id: true, companyName: true, city: true, niche: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return convs.map((c) => ({
    id: c.id,
    contactPhone: c.contactPhone,
    lead: c.lead,
    unreadCount: c.unreadCount,
    sequencePaused: c.sequencePaused,
    lastMessageAt: c.lastMessageAt,
    lastMessage: c.messages[0] ? serializeMessage(c.messages[0]) : null,
  }));
}

/** Conversa de um lead (abre a central direto pelo card do CRM). */
export async function conversationForLead(organizationId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId, deletedAt: null }, select: { id: true, phoneE164: true } });
  if (!lead) throw notFound("Lead não encontrado");
  if (!lead.phoneE164) return null;
  return prisma.whatsAppConversation.findFirst({ where: { organizationId, contactPhone: lead.phoneE164 }, select: { id: true } });
}

export async function getMessages(organizationId: string, conversationId: string) {
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, organizationId },
    include: { lead: { select: { id: true, companyName: true, phone: true, city: true, niche: true, website: true, consentBasis: true, stage: { select: { name: true } } } } },
  });
  if (!conv) throw notFound("Conversa não encontrada");
  const messages = await prisma.whatsAppMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 500 });
  if (conv.unreadCount > 0) await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  const blocked = await prisma.suppressionList.findUnique({ where: { organizationId_phoneE164: { organizationId, phoneE164: conv.contactPhone } } });
  return {
    conversation: { id: conv.id, contactPhone: conv.contactPhone, lead: conv.lead, sequencePaused: conv.sequencePaused, blocked: !!blocked },
    messages: messages.map(serializeMessage),
  };
}

/** Rascunhos preparados pelo Writer para o lead (só texto, nunca enviados automaticamente). */
export async function draftsForLead(organizationId: string, leadId: string) {
  const acts = await prisma.leadActivity.findMany({
    where: { organizationId, leadId, type: "MESSAGE_PREPARED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, createdAt: true, metadata: true },
  });
  return acts.map((a) => ({ id: a.id, createdAt: a.createdAt, body: (a.metadata as { body?: string }).body ?? "" })).filter((d) => d.body);
}

export async function listSuppression(organizationId: string) {
  return prisma.suppressionList.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 500 });
}

export async function removeSuppression(organizationId: string, id: string) {
  const row = await prisma.suppressionList.findFirst({ where: { id, organizationId } });
  if (!row) throw notFound();
  await prisma.suppressionList.delete({ where: { id } });
  if (row.phoneE164) await prisma.whatsAppConversation.updateMany({ where: { organizationId, contactPhone: row.phoneE164 }, data: { sequencePaused: false } });
}

export async function todayUsage(organizationId: string) {
  const cfg = await settings(organizationId);
  const sent = await prisma.whatsAppMessage.count({
    where: { organizationId, direction: "OUTBOUND", status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] }, createdAt: { gte: startOfLocalDay() } },
  });
  const queued = await prisma.whatsAppMessage.count({ where: { organizationId, status: "QUEUED" } });
  return { sentToday: sent, dailyLimit: cfg.dailyMessageLimit, intervalSec: cfg.messageIntervalSec, maxUnanswered: cfg.maxUnansweredMessages, queued };
}
