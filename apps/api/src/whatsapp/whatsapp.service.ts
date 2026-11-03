import QRCode from "qrcode";
import type { WhatsAppStatus } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";
import { officeEvents } from "../office/events/office-events.js";
import { BaileysProvider } from "./baileys/baileys.provider.js";
import { clearAuthState } from "./baileys/auth-state.js";
import { decryptSecret } from "../lib/crypto.js";
import type { ProviderFactory, WhatsAppProvider } from "./provider.js";
import { handleDelivery, handleInbound } from "./messages.service.js";

const PROVIDER = "WHATSAPP_QR" as const;
const MAX_RECONNECTS = 6;

interface Live {
  connectionId: string;
  provider: WhatsAppProvider;
  qr: string | null;
  everOpened: boolean;
  reconnects: number;
  timer?: NodeJS.Timeout;
}

let factory: ProviderFactory = (id, events) => new BaileysProvider(id, events);
/** Testes trocam o provedor real por um falso. */
export const setProviderFactory = (f: ProviderFactory) => {
  factory = f;
};

const live = new Map<string, Live>();

async function connectionFor(organizationId: string) {
  return (
    (await prisma.whatsAppConnection.findFirst({ where: { organizationId, provider: PROVIDER } })) ??
    (await prisma.whatsAppConnection.create({ data: { organizationId, provider: PROVIDER } }))
  );
}

async function log(organizationId: string, connectionId: string, level: "info" | "warn" | "error", message: string) {
  await prisma.whatsAppConnectionLog.create({ data: { organizationId, connectionId, level, message: message.slice(0, 1000) } }).catch(() => undefined);
}

async function setStatus(organizationId: string, connectionId: string, status: WhatsAppStatus, extra: { phoneNumber?: string | null; displayName?: string | null; lastError?: string | null } = {}) {
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { status, ...extra, ...(status === "CONNECTED" ? { lastSyncAt: new Date(), lastError: null } : {}) },
  });
  officeEvents.publish(organizationId, "whatsapp:status", await getStatus(organizationId));
}

function start(organizationId: string, connectionId: string): Live {
  const entry: Live = { connectionId, provider: null as unknown as WhatsAppProvider, qr: null, everOpened: false, reconnects: 0 };
  entry.provider = factory(connectionId, {
    onQr: (qr) => {
      void QRCode.toDataURL(qr, { margin: 1, width: 320 }).then(async (url) => {
        entry.qr = url;
        await setStatus(organizationId, connectionId, "CONNECTING");
        officeEvents.publish(organizationId, "whatsapp:qr", { qr: url });
      });
    },
    onOpen: ({ phoneE164, name }) => {
      entry.qr = null;
      entry.everOpened = true;
      entry.reconnects = 0;
      void log(organizationId, connectionId, "info", `Conectado${phoneE164 ? ` como ${phoneE164}` : ""}`);
      void setStatus(organizationId, connectionId, "CONNECTED", { phoneNumber: phoneE164, displayName: name ?? null });
    },
    onClose: ({ loggedOut, reason }) => void handleClose(organizationId, entry, loggedOut, reason),
    onMessage: (msg) => void handleInbound(organizationId, connectionId, msg).catch((err) => logger.error({ err }, "falha ao registrar mensagem recebida")),
    onDelivery: (u) => void handleDelivery(organizationId, u).catch(() => undefined),
    onLog: (level, message) => void log(organizationId, connectionId, level, message),
  });
  live.set(organizationId, entry);
  return entry;
}

async function handleClose(organizationId: string, entry: Live, loggedOut: boolean, reason: string) {
  const { connectionId } = entry;
  entry.qr = null;
  if (loggedOut) {
    live.delete(organizationId);
    await clearAuthState(connectionId);
    await log(organizationId, connectionId, "warn", "Sessão encerrada pelo celular. Conecte de novo com o QR Code.");
    return setStatus(organizationId, connectionId, "DISCONNECTED", { phoneNumber: null, lastError: null });
  }
  const paired = entry.everOpened || (await isRegistered(connectionId));
  if (!paired) {
    // QR não foi lido a tempo: não fica gerando QR para sempre.
    live.delete(organizationId);
    await log(organizationId, connectionId, "info", "QR Code expirou sem leitura.");
    return setStatus(organizationId, connectionId, "DISCONNECTED");
  }
  if (entry.reconnects >= MAX_RECONNECTS) {
    live.delete(organizationId);
    await log(organizationId, connectionId, "error", `Não foi possível reconectar: ${reason}`);
    return setStatus(organizationId, connectionId, "RECONNECT_REQUIRED", { lastError: reason });
  }
  // Reinício pedido pelo WhatsApp logo após o pareamento é normal: reconecta já.
  const delay = reason.includes("restartRequired") ? 0 : Math.min(2 ** entry.reconnects * 2000, 60_000);
  entry.reconnects++;
  await log(organizationId, connectionId, "warn", `Conexão caiu (${reason}). Reconectando${delay ? ` em ${delay / 1000}s` : ""}…`);
  await setStatus(organizationId, connectionId, "CONNECTING");
  entry.timer = setTimeout(() => {
    const next = start(organizationId, connectionId);
    next.everOpened = entry.everOpened;
    next.reconnects = entry.reconnects;
    void next.provider.start().catch((err: Error) => handleClose(organizationId, next, false, err.message));
  }, delay);
}

async function isRegistered(connectionId: string) {
  const row = await prisma.whatsAppAuthKey.findUnique({ where: { connectionId_type_keyId: { connectionId, type: "creds", keyId: "creds" } } });
  if (!row) return false;
  // "me" só existe nas credenciais depois que o QR foi lido.
  return decryptSecret(row.value).includes('"me"');
}

export async function connect(organizationId: string) {
  const conn = await connectionFor(organizationId);
  const current = live.get(organizationId);
  if (current) return getStatus(organizationId);
  await log(organizationId, conn.id, "info", "Iniciando conexão por QR Code");
  await setStatus(organizationId, conn.id, "CONNECTING", { lastError: null });
  const entry = start(organizationId, conn.id);
  try {
    await entry.provider.start();
  } catch (err) {
    live.delete(organizationId);
    await log(organizationId, conn.id, "error", (err as Error).message);
    await setStatus(organizationId, conn.id, "ERROR", { lastError: (err as Error).message });
  }
  return getStatus(organizationId);
}

export async function disconnect(organizationId: string) {
  const conn = await connectionFor(organizationId);
  const entry = live.get(organizationId);
  live.delete(organizationId);
  if (entry?.timer) clearTimeout(entry.timer);
  await entry?.provider.logout();
  await clearAuthState(conn.id);
  await log(organizationId, conn.id, "info", "Desconectado pelo usuário");
  await setStatus(organizationId, conn.id, "DISCONNECTED", { phoneNumber: null });
  return getStatus(organizationId);
}

/** Reconectar = fechar a conexão local e abrir de novo com a mesma sessão (sem novo QR, se ainda válida). */
export async function reconnect(organizationId: string) {
  const entry = live.get(organizationId);
  live.delete(organizationId);
  if (entry?.timer) clearTimeout(entry.timer);
  await entry?.provider.stop();
  return connect(organizationId);
}

export async function getStatus(organizationId: string) {
  const conn = await connectionFor(organizationId);
  const logs = await prisma.whatsAppConnectionLog.findMany({ where: { connectionId: conn.id }, orderBy: { createdAt: "desc" }, take: 30 });
  return {
    provider: "QR_CODE",
    status: conn.status,
    phoneNumber: conn.phoneNumber,
    displayName: conn.displayName,
    lastSyncAt: conn.lastSyncAt,
    lastError: conn.lastError,
    qr: live.get(organizationId)?.qr ?? null,
    logs: logs.map((l) => ({ id: l.id, level: l.level, message: l.message, createdAt: l.createdAt })),
  };
}

/** Provedor ativo e conectado da organização (usado pelo despachante de mensagens). */
export async function activeProvider(organizationId: string) {
  const entry = live.get(organizationId);
  const conn = await prisma.whatsAppConnection.findFirst({ where: { organizationId, provider: PROVIDER } });
  if (!entry || conn?.status !== "CONNECTED") throw new AppError(409, "WHATSAPP_DISCONNECTED", "WhatsApp não está conectado");
  return { provider: entry.provider, connectionId: conn.id };
}

/** Ao subir o servidor, retoma as sessões que estavam conectadas (sem pedir QR de novo). */
export async function restoreConnections() {
  const conns = await prisma.whatsAppConnection.findMany({ where: { provider: PROVIDER, status: { in: ["CONNECTED", "CONNECTING", "RECONNECT_REQUIRED"] } } });
  for (const c of conns) {
    if (await isRegistered(c.id)) {
      logger.info({ organizationId: c.organizationId }, "restaurando sessão do WhatsApp");
      const entry = start(c.organizationId, c.id);
      entry.everOpened = true;
      void entry.provider.start().catch((err: Error) => handleClose(c.organizationId, entry, false, err.message));
    } else {
      await prisma.whatsAppConnection.update({ where: { id: c.id }, data: { status: "DISCONNECTED" } });
    }
  }
}

export async function stopAll() {
  for (const [org, entry] of live) {
    if (entry.timer) clearTimeout(entry.timer);
    await entry.provider.stop().catch(() => undefined);
    live.delete(org);
  }
}
