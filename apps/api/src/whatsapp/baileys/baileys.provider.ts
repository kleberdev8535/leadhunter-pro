import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, type WASocket } from "baileys";
import pino from "pino";
import { e164ToJid, jidToE164, type ProviderEvents, type WhatsAppProvider } from "../provider.js";
import { usePostgresAuthState } from "./auth-state.js";

const silent = pino({ level: "silent" });

function textOf(m: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null; imageMessage?: { caption?: string | null } | null } | null | undefined) {
  return m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? null;
}

/**
 * Conexão por QR Code via Baileys (protocolo do WhatsApp Web). Não é a API oficial da Meta:
 * o uso precisa ser moderado e individual para não colocar o número em risco.
 */
export class BaileysProvider implements WhatsAppProvider {
  private sock: WASocket | null = null;
  private stopped = false;

  constructor(
    private readonly connectionId: string,
    private readonly events: ProviderEvents,
  ) {}

  async start() {
    this.stopped = false;
    const { state, saveCreds } = await usePostgresAuthState(this.connectionId);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silent) },
      logger: silent,
      browser: Browsers.ubuntu("LeadHunter Pro"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Não baixa o histórico antigo: só interessa o que chega daqui em diante.
      shouldSyncHistoryMessage: () => false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", () => void saveCreds());

    sock.ev.on("connection.update", (u) => {
      if (u.qr) this.events.onQr(u.qr);
      if (u.connection === "open") {
        this.events.onOpen({ phoneE164: jidToE164(sock.user?.id ?? null), name: sock.user?.name ?? undefined });
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const reason = code ? `${DisconnectReason[code] ?? "desconhecido"} (${code})` : (u.lastDisconnect?.error?.message ?? "conexão encerrada");
        if (!this.stopped) this.events.onClose({ loggedOut, reason });
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const jid = m.key.remoteJid ?? "";
        // Ignora grupos, status e mensagens enviadas por mim (já registradas no envio).
        if (m.key.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) continue;
        const body = textOf(m.message as never);
        if (!body || !m.key.id) continue;
        this.events.onMessage({
          externalId: m.key.id,
          fromE164: jidToE164(jid) ?? jidToE164(m.key.remoteJidAlt),
          chatId: jid,
          body,
          timestamp: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000),
          pushName: m.pushName ?? undefined,
        });
      }
    });

    sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || update.status == null) continue;
        // 3 = entregue, 4 = lida, 0 = erro (enum WebMessageInfo.Status)
        const status = update.status >= 4 ? "READ" : update.status === 3 ? "DELIVERED" : update.status === 0 ? "FAILED" : null;
        if (status) this.events.onDelivery({ externalId: key.id, status });
      }
    });
  }

  async sendText(toE164: string, body: string) {
    if (!this.sock) throw new Error("WhatsApp não conectado");
    const jid = e164ToJid(toE164);
    const [exists] = (await this.sock.onWhatsApp(jid)) ?? [];
    if (!exists?.exists) throw new Error("Este número não tem WhatsApp");
    const sent = await this.sock.sendMessage(exists.jid, { text: body });
    if (!sent?.key.id) throw new Error("O WhatsApp não confirmou o envio");
    return sent.key.id;
  }

  async logout() {
    this.stopped = true;
    await this.sock?.logout().catch(() => undefined);
    this.sock = null;
  }

  async stop() {
    this.stopped = true;
    this.sock?.end(undefined);
    this.sock = null;
  }
}
