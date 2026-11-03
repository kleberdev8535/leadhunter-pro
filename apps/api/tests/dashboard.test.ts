import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function addLead(organizationId: string, stageKey: string, data: Partial<{ city: string; niche: string; website: string }> = {}) {
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { organizationId, key: stageKey } });
  return prisma.lead.create({
    data: { organizationId, pipelineId: stage.pipelineId, stageId: stage.id, companyName: `Empresa ${Math.random()}`, ...data },
  });
}

describe("dashboard", () => {
  it("começa zerado para uma organização nova", async () => {
    const { token } = await registerAndLogin();
    const res = await api().get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(res.body.cards.totalLeads).toBe(0);
    expect(res.body.cards.conversionRate).toBe(0);
    expect(res.body.today).toEqual({ found: 0, approached: 0, replied: 0, interested: 0, converted: 0 });
  });

  it("calcula indicadores a partir dos dados do banco", async () => {
    const { token, organizationId, userId } = await registerAndLogin();
    const a = await addLead(organizationId, "new", { city: "Osasco", niche: "Barbearias" });
    await addLead(organizationId, "qualified", { city: "Osasco", niche: "Barbearias", website: "https://x.com" });
    const won = await addLead(organizationId, "won", { city: "Barueri", niche: "Academias" });
    await addLead(organizationId, "lost", { city: "Barueri" });
    await prisma.leadActivity.createMany({
      data: [
        { organizationId, leadId: a.id, actorId: userId, type: "MESSAGE_SENT", description: "Mensagem enviada" },
        { organizationId, leadId: a.id, actorId: userId, type: "MESSAGE_SENT", description: "Mensagem enviada" },
        { organizationId, leadId: won.id, actorId: userId, type: "CONVERTED", description: "Convertido" },
      ],
    });

    const auth = { Authorization: `Bearer ${token}` };
    const summary = await api().get("/api/dashboard/summary?days=7").set(auth).expect(200);
    expect(summary.body.cards).toMatchObject({
      totalLeads: 4,
      newLeads: 1,
      withoutWebsite: 3,
      qualified: 2,
      contacted: 1, // leads distintos, não mensagens
      converted: 1,
      conversionRate: 25,
    });
    expect(summary.body.today).toMatchObject({ found: 4, approached: 1, converted: 1 });

    const charts = await api().get("/api/dashboard/charts?days=7").set(auth).expect(200);
    expect(charts.body.leadsPerDay).toHaveLength(7);
    expect(charts.body.leadsPerDay.at(-1).total).toBe(4);
    expect(charts.body.byCity).toEqual(expect.arrayContaining([{ label: "Osasco", total: 2 }]));
    expect(charts.body.funnel).toHaveLength(9);
    expect(charts.body.funnel.find((s: { key: string }) => s.key === "won").total).toBe(1);

    const acts = await api().get("/api/dashboard/activities").set(auth).expect(200);
    expect(acts.body).toHaveLength(3);
  });

  it("isola os dados entre organizações", async () => {
    const orgA = await registerAndLogin();
    const orgB = await registerAndLogin();
    await addLead(orgA.organizationId, "new");
    await addLead(orgA.organizationId, "won");

    const resB = await api().get("/api/dashboard/summary").set("Authorization", `Bearer ${orgB.token}`).expect(200);
    expect(resB.body.cards.totalLeads).toBe(0);
    const actsB = await api().get("/api/dashboard/charts").set("Authorization", `Bearer ${orgB.token}`).expect(200);
    expect(actsB.body.funnel.every((s: { total: number }) => s.total === 0)).toBe(true);
  });

  it("valida o período", async () => {
    const { token } = await registerAndLogin();
    await api().get("/api/dashboard/summary?days=13").set("Authorization", `Bearer ${token}`).expect(400);
  });

  it("ignora leads excluídos (soft delete)", async () => {
    const { token, organizationId } = await registerAndLogin();
    const lead = await addLead(organizationId, "new");
    await prisma.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    const res = await api().get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(res.body.cards.totalLeads).toBe(0);
  });
});
