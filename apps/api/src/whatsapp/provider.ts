/**
 * Camada de integração independente do provedor. Hoje: QR Code (Baileys, protocolo do WhatsApp Web).
 * Amanhã: WhatsApp Business Cloud API, implementando a mesma interface.
 */
export interface InboundMessage {
  externalId: string;
  /** Telefone em E.164 (+5511…), quando o WhatsApp informa. */
  fromE164: string | null;
  /** Identificador bruto do contato no provedor (jid). */
  chatId: string;
  body: string;
  timestamp: Date;
  pushName?: string;
}

export interface ProviderEvents {
  onQr(qr: string): void;
  onOpen(info: { phoneE164: string | null; name?: string }): void;
  /** loggedOut = o usuário desconectou pelo celular (sessão inválida, precisa de novo QR). */
  onClose(info: { loggedOut: boolean; reason: string }): void;
  onMessage(msg: InboundMessage): void;
  onDelivery(update: { externalId: string; status: "DELIVERED" | "READ" | "FAILED" }): void;
  onLog(level: "info" | "warn" | "error", message: string): void;
}

export interface WhatsAppProvider {
  start(): Promise<void>;
  /** Envia texto e devolve o id da mensagem no provedor. */
  sendText(toE164: string, body: string): Promise<string>;
  /** Encerra a sessão no WhatsApp (o aparelho deixa de aparecer em "aparelhos conectados"). */
  logout(): Promise<void>;
  /** Fecha a conexão local sem invalidar a sessão (usado ao desligar o servidor). */
  stop(): Promise<void>;
}

export type ProviderFactory = (connectionId: string, events: ProviderEvents) => WhatsAppProvider;

/** "5511999999999@s.whatsapp.net" → "+5511999999999". Ids @lid (anônimos) não viram telefone. */
export function jidToE164(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const digits = jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : null;
}

export const e164ToJid = (e164: string) => `${e164.replace(/\D/g, "")}@s.whatsapp.net`;
