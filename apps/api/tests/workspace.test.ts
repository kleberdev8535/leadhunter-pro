import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { generateTaskNotifications } from "../src/modules/workspace/workspace.service.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const lead = async (token: string, body: Record<string, unknown> = {}) =>
  (await api().post("/api/crm/leads").set(auth(token)).send({ companyName: "Barbearia Alfa", city: "Osasco", niche: "Barbearias", phone: "(11) 98888-7777", ...body }).expect(201)).body as { id: string };

describe("Gerar mensagem (backend, sem IA externa)", () => {
  it("exige perfil comercial e gera texto com os dados do lead e o argumento do nicho", async () => {
    const { token } = await registerAndLogin();
    const l = await lead(token);
    const r = await api().post("/api/whatsapp/compose").set(auth(token)).send({ leadId: l.id, kind: "INITIAL" }).expect(400);
    expect(r.body.error.message).toMatch(/Configurações → Prospecção/);
    await api().put("/api/integrations/prospecting").set(auth(token))
      .send({ dailySearchLimit: 500, monthlyRequestBudget: 2000, favoriteNiches: [], senderName: "Lucas", serviceOffered: "criação de sites" }).expect(200);
    const ok = await api().post("/api/whatsapp/compose").set(auth(token)).send({ leadId: l.id, kind: "INITIAL" }).expect(200);
    expect(ok.body.body).toContain("Barbearia Alfa");
    expect(ok.body.body).toContain("Lucas");
    expect(ok.body.body).toMatch(/agendamento online/); // argumento do nicho de barbearia
    expect(ok.body.body).not.toMatch(/analis/i);
  });

  it("templates: cria, lista e exclui só na própria organização", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const t = await api().post("/api/whatsapp/templates").set(auth(a.token)).send({ name: "Inicial", body: "Olá {empresa}" }).expect(201);
    expect((await api().get("/api/whatsapp/templates").set(auth(b.token)).expect(200)).body).toHaveLength(0);
    await api().delete(`/api/whatsapp/templates/${t.body.id}`).set(auth(b.token)).expect(404);
    await api().delete(`/api/whatsapp/templates/${t.body.id}`).set(auth(a.token)).expect(204);
  });
});

describe("Agenda e lembretes", () => {
  it("separa atrasadas, hoje e próximas, e gera lembrete uma única vez", async () => {
    const { token, userId } = await registerAndLogin();
    const l = await lead(token);
    const mk = (title: string, offsetMs: number) =>
      api().post("/api/crm/tasks").set(auth(token)).send({ leadId: l.id, title, dueAt: new Date(Date.now() + offsetMs).toISOString() }).expect(201);
    await mk("Atrasada", -2 * 86_400_000);
    await mk("Em 3 dias", 3 * 86_400_000);
    const ag = await api().get("/api/workspace/agenda").set(auth(token)).expect(200);
    expect(ag.body.overdue.map((t: { title: string }) => t.title)).toEqual(["Atrasada"]);
    expect(ag.body.upcoming.map((t: { title: string }) => t.title)).toEqual(["Em 3 dias"]);

    expect(await generateTaskNotifications()).toBe(1);
    expect(await generateTaskNotifications()).toBe(0);
    const n = await api().get("/api/workspace/notifications").set(auth(token)).expect(200);
    expect(n.body.unread).toBe(1);
    expect(n.body.items[0].title).toMatch(/atrasada/i);
    await api().post("/api/workspace/notifications/read").set(auth(token)).send({}).expect(204);
    expect((await api().get("/api/workspace/notifications").set(auth(token))).body.unread).toBe(0);
    expect(userId).toBeTruthy();
  });

  it("mostra leads parados sem tarefa nem atividade recente", async () => {
    const { token } = await registerAndLogin();
    const l = await lead(token);
    const stages = (await api().get("/api/crm/pipeline").set(auth(token))).body.stages;
    await api().post(`/api/crm/leads/${l.id}/move`).set(auth(token)).send({ stageId: stages.find((s: { key: string }) => s.key === "negotiation").id, index: 0 }).expect(200);
    await prisma.leadActivity.updateMany({ data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    const ag = await api().get("/api/workspace/agenda").set(auth(token)).expect(200);
    expect(ag.body.stale.map((x: { id: string }) => x.id)).toEqual([l.id]);
  });
});

describe("Relatórios e exportação", () => {
  it("calcula funil cumulativo, nichos e taxa", async () => {
    const { token } = await registerAndLogin();
    const stages = (await api().get("/api/crm/pipeline").set(auth(token))).body.stages as { id: string; key: string }[];
    const sid = (k: string) => stages.find((s) => s.key === k)!.id;
    const a = await lead(token, { phone: null });
    const b = await lead(token, { companyName: "Pizzaria Beta", niche: "Pizzarias", phone: null });
    await lead(token, { companyName: "Academia Gama", niche: "Academias", phone: null });
    await api().post(`/api/crm/leads/${a.id}/move`).set(auth(token)).send({ stageId: sid("won"), index: 0 }).expect(200);
    await api().post(`/api/crm/leads/${b.id}/move`).set(auth(token)).send({ stageId: sid("meeting"), index: 0 }).expect(200);
    const r = (await api().get("/api/workspace/reports?days=30").set(auth(token)).expect(200)).body;
    const f = Object.fromEntries(r.funnel.map((x: { key: string; reached: number }) => [x.key, x.reached]));
    expect(f).toMatchObject({ new: 3, meeting: 2, won: 1 });
    expect(r.totals).toMatchObject({ leadsCreated: 3, conversions: 1, meetings: 1 });
    expect(r.byNiche.find((n: { label: string }) => n.label === "Barbearias")).toMatchObject({ total: 1, won: 1 });
  });

  it("exporta CSV protegido contra injeção de fórmula", async () => {
    const { token } = await registerAndLogin();
    await lead(token, { companyName: "=HYPERLINK(\"http://x\")", phone: null });
    const res = await api().get("/api/workspace/reports/leads.csv").set(auth(token)).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe("Administração", () => {
  it("renomeia etapa e valida campos personalizados por tipo", async () => {
    const { token } = await registerAndLogin();
    const stages = (await api().get("/api/crm/pipeline").set(auth(token))).body.stages;
    await api().patch(`/api/workspace/stages/${stages[0].id}`).set(auth(token)).send({ name: "Entrada", color: "#112233" }).expect(204);
    expect((await api().get("/api/crm/pipeline").set(auth(token))).body.stages[0].name).toBe("Entrada");

    await api().post("/api/workspace/custom-fields").set(auth(token)).send({ label: "Funcionários", type: "NUMBER" }).expect(201);
    await api().post("/api/workspace/custom-fields").set(auth(token)).send({ label: "Plano", type: "SELECT", options: ["Básico", "Pro"] }).expect(201);
    const l = await lead(token);
    const saved = await api().put(`/api/workspace/leads/${l.id}/custom-fields`).set(auth(token)).send({ values: { funcionarios: "12", plano: "Ouro", inexistente: "x" } }).expect(200);
    expect(saved.body).toEqual({ funcionarios: 12 });
  });

  it("busca global encontra leads só da organização", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    await lead(a.token);
    expect((await api().get("/api/workspace/search?q=alfa").set(auth(a.token)).expect(200)).body.leads).toHaveLength(1);
    expect((await api().get("/api/workspace/search?q=alfa").set(auth(b.token)).expect(200)).body.leads).toHaveLength(0);
  });

  it("auditoria é restrita a dono/admin", async () => {
    const { token, organizationId } = await registerAndLogin();
    const logs = await api().get("/api/workspace/audit").set(auth(token)).expect(200);
    expect(logs.body.some((l: { action: string }) => l.action === "auth.register")).toBe(true);
    // Rebaixa para membro e confirma o bloqueio.
    await prisma.membership.updateMany({ where: { organizationId }, data: { role: "MEMBER" } });
    await api().get("/api/workspace/audit").set(auth(token)).expect(403);
  });
});
