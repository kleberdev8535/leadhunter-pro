import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { setProviderFactory, stopAll, activeProvider } from "../src/whatsapp/whatsapp.service.js";
import { dispatchDue, handleInbound, isOptOut } from "../src/whatsapp/messages.service.js";
import { usePostgresAuthState } from "../src/whatsapp/baileys/auth-state.js";
import { jidToE164, type ProviderEvents, type WhatsAppProvider } from "../src/whatsapp/provider.js";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** Provedor falso: permite simular QR, conexão, mensagens e quedas. */
class FakeProvider implements WhatsAppProvider {
  static last: FakeProvider | null = null;
  sent: { to: string; body: string }[] = [];
  failNext = false;
  constructor(public id: string, public events: ProviderEvents) {
    FakeProvider.last = this;
  }
  async start() {
    this.events.onQr("QR-DE-TESTE");
  }
  async sendText(to: string, body: string) {
    if (this.failNext) throw new Error("Este número não tem WhatsApp");
    this.sent.push({ to, body });
    return `ext-${this.sent.length}-${randomUUID()}`;
  }
  async logout() {}
  async stop() {}
}

setProviderFactory((id, events) => new FakeProvider(id, events));

beforeEach(resetDb);
afterEach(() => stopAll());
afterAll(() => prisma.$disconnect());

async function connected() {
  const user = await registerAndLogin();
  await api().post("/api/whatsapp/connect").set(auth(user.token)).expect(200);
  await wait();
  FakeProvider.last!.events.onOpen({ phoneE164: "+5511900000000", name: "Comercial" });
  await wait();
  return user;
}

async function lead(token: string, phone = "(11) 98888-7777", companyName = "Barbearia Alfa") {
  return (await api().post("/api/crm/leads").set(auth(token)).send({ companyName, phone }).expect(201)).body as { id: string };
}

const send = (token: string, leadId: string, body: string, extra: Record<string, unknown> = {}) =>
  api().post("/api/whatsapp/messages").set(auth(token)).send({ leadId, body, idempotencyKey: randomUUID(), legalBasis: "LEGITIMATE_INTEREST", ...extra });

describe("conexão por QR Code", () => {
  it("mostra o QR, conecta e registra logs", async () => {
    const { token } = await registerAndLogin();
    const res = await api().post("/api/whatsapp/connect").set(auth(token)).expect(200);
    await wait();
    const s1 = await api().get("/api/whatsapp/status").set(auth(token)).expect(200);
    expect(s1.body.status).toBe("CONNECTING");
    expect(s1.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.provider).toBe("QR_CODE");

    FakeProvider.last!.events.onOpen({ phoneE164: "+5511900000000" });
    await wait();
    const s2 = await api().get("/api/whatsapp/status").set(auth(token)).expect(200);
    expect(s2.body).toMatchObject({ status: "CONNECTED", phoneNumber: "+5511900000000", qr: null });
    expect(s2.body.logs.map((l: { message: string }) => l.message).join(" ")).toMatch(/Conectado/);
  });

  it("logout pelo celular derruba a sessão e apaga as credenciais", async () => {
    const { token, organizationId } = await connected();
    const conn = await prisma.whatsAppConnection.findFirstOrThrow({ where: { organizationId } });
    await prisma.whatsAppAuthKey.create({ data: { connectionId: conn.id, type: "creds", keyId: "creds", value: "x" } });
    FakeProvider.last!.events.onClose({ loggedOut: true, reason: "loggedOut (401)" });
    await wait(150);
    const s = await api().get("/api/whatsapp/status").set(auth(token)).expect(200);
    expect(s.body.status).toBe("DISCONNECTED");
    expect(await prisma.whatsAppAuthKey.count()).toBe(0);
  });

  it("QR não lido não fica gerando código para sempre", async () => {
    const { token } = await registerAndLogin();
    await api().post("/api/whatsapp/connect").set(auth(token)).expect(200);
    await wait();
    FakeProvider.last!.events.onClose({ loggedOut: false, reason: "timedOut (408)" });
    await wait(150);
    expect((await api().get("/api/whatsapp/status").set(auth(token))).body.status).toBe("DISCONNECTED");
  });

  it("guarda a sessão criptografada no banco", async () => {
    const { organizationId } = await registerAndLogin();
    const conn = await prisma.whatsAppConnection.create({ data: { organizationId, provider: "WHATSAPP_QR" } });
    const a = await usePostgresAuthState(conn.id);
    await a.saveCreds();
    await a.state.keys.set({ session: { "abc": Buffer.from("segredo-da-sessao") } });
    const raw = await prisma.whatsAppAuthKey.findMany({ where: { connectionId: conn.id } });
    expect(raw.some((r) => r.value.includes("segredo"))).toBe(false);
    const b = await usePostgresAuthState(conn.id);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
    const got = await b.state.keys.get("session", ["abc"]);
    expect(Buffer.from(got.abc!).toString()).toBe("segredo-da-sessao");
  });
});

describe("regras de envio", () => {
  it("exige WhatsApp conectado", async () => {
    const { token } = await registerAndLogin();
    const l = await lead(token);
    const r = await send(token, l.id, "Olá").expect(409);
    expect(r.body.error.code).toBe("WHATSAPP_DISCONNECTED");
  });

  it("no primeiro contato exige base legal e a registra no lead", async () => {
    const { token } = await connected();
    const l = await lead(token);
    const r = await send(token, l.id, "Olá", { legalBasis: undefined }).expect(409);
    expect(r.body.error.code).toBe("LEGAL_BASIS_REQUIRED");
    await send(token, l.id, "Olá").expect(201);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).consentBasis).toBe("LEGITIMATE_INTEREST");
  });

  it("enfileira respeitando o intervalo mínimo entre envios", async () => {
    const { token, organizationId } = await connected();
    await prisma.organizationSettings.update({ where: { organizationId }, data: { messageIntervalSec: 120 } });
    const a = await lead(token, "(11) 91111-1111", "Empresa A");
    const b = await lead(token, "(11) 92222-2222", "Empresa B");
    const m1 = (await send(token, a.id, "Olá A").expect(201)).body;
    const m2 = (await send(token, b.id, "Olá B").expect(201)).body;
    expect(new Date(m2.sendAfter).getTime() - new Date(m1.sendAfter).getTime()).toBeGreaterThanOrEqual(120_000);
  });

  it("bloqueia limite diário, duplicidade e insistência sem resposta", async () => {
    const { token, organizationId } = await connected();
    await prisma.organizationSettings.update({ where: { organizationId }, data: { dailyMessageLimit: 3, maxUnansweredMessages: 2 } });
    const a = await lead(token, "(11) 91111-1111", "Empresa A");
    await send(token, a.id, "Mensagem 1").expect(201);
    expect((await send(token, a.id, "Mensagem 1").expect(409)).body.error.code).toBe("DUPLICATE_MESSAGE");
    await send(token, a.id, "Mensagem 2").expect(201);
    expect((await send(token, a.id, "Mensagem 3").expect(409)).body.error.code).toBe("TOO_MANY_UNANSWERED");
    const b = await lead(token, "(11) 92222-2222", "Empresa B");
    await send(token, b.id, "Oi B").expect(201);
    const c = await lead(token, "(11) 93333-3333", "Empresa C");
    expect((await send(token, c.id, "Oi C").expect(429)).body.error.code).toBe("DAILY_LIMIT");
  });

  it("reenvio com a mesma chave não duplica", async () => {
    const { token } = await connected();
    const l = await lead(token);
    const key = randomUUID();
    const a = await send(token, l.id, "Olá", { idempotencyKey: key }).expect(201);
    const b = await send(token, l.id, "Olá", { idempotencyKey: key }).expect(200);
    expect(b.body.id).toBe(a.body.id);
  });

  it("não envia para quem está na lista de bloqueio", async () => {
    const { token } = await connected();
    const l = await lead(token);
    await api().post("/api/whatsapp/suppression").set(auth(token)).send({ phone: "(11) 98888-7777", reason: "Pediu" }).expect(201);
    expect((await send(token, l.id, "Olá").expect(409)).body.error.code).toBe("SUPPRESSED");
  });
});

describe("despacho e recebimento", () => {
  it("envia pela fila, registra no CRM e marca falhas", async () => {
    const { token, organizationId } = await connected();
    const l = await lead(token);
    const m = (await send(token, l.id, "Olá, tudo bem?").expect(201)).body;
    await dispatchDue(activeProvider);
    const sent = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(sent.status).toBe("SENT");
    expect(FakeProvider.last!.sent).toEqual([{ to: "+5511988887777", body: "Olá, tudo bem?" }]);
    expect(await prisma.leadActivity.count({ where: { leadId: l.id, type: "MESSAGE_SENT" } })).toBe(1);

    const l2 = await lead(token, "(11) 95555-5555", "Sem WhatsApp");
    const m2 = (await send(token, l2.id, "Oi").expect(201)).body;
    await prisma.whatsAppMessage.update({ where: { id: m2.id }, data: { sendAfter: new Date() } });
    FakeProvider.last!.failNext = true;
    await dispatchDue(activeProvider);
    const failed = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: m2.id } });
    expect(failed).toMatchObject({ status: "FAILED", error: "Este número não tem WhatsApp" });
    expect(organizationId).toBeTruthy();
  });

  it("guarda respostas de leads e ignora conversas pessoais", async () => {
    const { token, organizationId } = await connected();
    const l = await lead(token);
    const conn = await prisma.whatsAppConnection.findFirstOrThrow({ where: { organizationId } });
    await handleInbound(organizationId, conn.id, { externalId: "in-1", fromE164: "+5511988887777", chatId: "x", body: "Tenho interesse!", timestamp: new Date() });
    await handleInbound(organizationId, conn.id, { externalId: "in-1", fromE164: "+5511988887777", chatId: "x", body: "Tenho interesse!", timestamp: new Date() });
    await handleInbound(organizationId, conn.id, { externalId: "in-2", fromE164: "+5511977776666", chatId: "y", body: "Oi mãe", timestamp: new Date() });
    expect(await prisma.whatsAppMessage.count({ where: { direction: "INBOUND" } })).toBe(1);
    expect(await prisma.leadActivity.count({ where: { leadId: l.id, type: "REPLY_RECEIVED" } })).toBe(1);
    const convs = await api().get("/api/whatsapp/conversations").set(auth(token)).expect(200);
    expect(convs.body).toHaveLength(1);
    expect(convs.body[0].unreadCount).toBe(1);
  });

  it("pedido de saída bloqueia o contato e cancela o que estava na fila", async () => {
    const { token, organizationId } = await connected();
    const l = await lead(token);
    const m = (await send(token, l.id, "Olá").expect(201)).body;
    const conn = await prisma.whatsAppConnection.findFirstOrThrow({ where: { organizationId } });
    await handleInbound(organizationId, conn.id, { externalId: "in-x", fromE164: "+5511988887777", chatId: "x", body: "Não quero receber", timestamp: new Date() });
    expect(await prisma.suppressionList.count({ where: { organizationId, phoneE164: "+5511988887777" } })).toBe(1);
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("FAILED");
    expect((await send(token, l.id, "Outra").expect(409)).body.error.code).toBe("SUPPRESSED");
  });

  it("uma organização não lê conversas da outra", async () => {
    const a = await connected();
    const l = await lead(a.token);
    await send(a.token, l.id, "Olá").expect(201);
    const conv = await prisma.whatsAppConversation.findFirstOrThrow();
    const b = await registerAndLogin();
    await api().get(`/api/whatsapp/conversations/${conv.id}`).set(auth(b.token)).expect(404);
    expect((await api().get("/api/whatsapp/conversations").set(auth(b.token)).expect(200)).body).toHaveLength(0);
  });
});

describe("utilitários", () => {
  it("reconhece pedidos de saída sem pegar frases normais", () => {
    for (const t of ["SAIR", "parar", "Não quero receber", "nao tenho interesse", "me tira da lista"]) expect(isOptOut(t)).toBe(true);
    for (const t of ["Quero saber mais", "Pode me mandar a proposta?", "Vou parar pra almoçar e te chamo"]) expect(isOptOut(t)).toBe(false);
  });
  it("converte jid em telefone e ignora ids anônimos", () => {
    expect(jidToE164("5511988887777@s.whatsapp.net")).toBe("+5511988887777");
    expect(jidToE164("5511988887777:12@s.whatsapp.net")).toBe("+5511988887777");
    expect(jidToE164("123456789@lid")).toBeNull();
  });
});
