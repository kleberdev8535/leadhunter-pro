import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { phoneToE164, purgeExpiredSearchResults } from "../src/modules/crm/crm.service.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function stages(token: string) {
  const res = await api().get("/api/crm/pipeline").set(auth(token)).expect(200);
  return Object.fromEntries(res.body.stages.map((s: { key: string; id: string }) => [s.key, s.id])) as Record<string, string>;
}

async function newLead(token: string, body: Record<string, unknown> = {}) {
  const res = await api().post("/api/crm/leads").set(auth(token)).send({ companyName: "Barbearia Alfa", city: "Osasco", niche: "Barbearias", phone: "(11) 98888-7777", ...body }).expect(201);
  return res.body as { id: string; stageId: string };
}

async function seedSearch(organizationId: string, n: number, opts: { website?: boolean } = {}) {
  const job = await prisma.searchJob.create({ data: { organizationId, status: "COMPLETED", params: {}, requestedCount: n } });
  for (let i = 0; i < n; i++) {
    await prisma.searchResult.create({
      data: {
        organizationId, searchJobId: job.id, placeId: `pl-${i}`, name: `Empresa ${i}`,
        data: { name: `Empresa ${i}`, niche: "Barbearias", category: null, address: null, neighborhood: null, city: "Osasco", state: "SP",
          phone: null, phoneE164: null, website: opts.website ? "https://x.com" : null, rating: null, reviewCount: null, googleMapsUrl: null, fetchedAt: new Date().toISOString() },
      },
    });
  }
  return job.id;
}

describe("leads manuais", () => {
  it("cria, lista, edita e exclui (soft delete) com auditoria", async () => {
    const { token } = await registerAndLogin();
    const lead = await newLead(token, { email: "contato@alfa.com" });
    const s = await stages(token);
    expect(lead.stageId).toBe(s.new);

    const list = await api().get("/api/crm/leads").set(auth(token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].phoneE164).toBe("+5511988887777");

    const upd = await api().patch(`/api/crm/leads/${lead.id}`).set(auth(token)).send({ contactName: "João", website: "https://alfa.com" }).expect(200);
    expect(upd.body.contactName).toBe("João");
    expect(upd.body.activities.map((a: { type: string }) => a.type)).toContain("LEAD_UPDATED");

    await api().delete(`/api/crm/leads/${lead.id}`).set(auth(token)).expect(204);
    expect((await api().get("/api/crm/leads").set(auth(token)).expect(200)).body).toHaveLength(0);
    expect(await prisma.lead.count()).toBe(1); // continua no banco
    expect(await prisma.auditLog.count({ where: { action: "lead.delete" } })).toBe(1);
  });

  it("valida dados e barra telefone duplicado", async () => {
    const { token } = await registerAndLogin();
    await api().post("/api/crm/leads").set(auth(token)).send({ companyName: "A", email: "x" }).expect(400);
    await newLead(token);
    const dup = await api().post("/api/crm/leads").set(auth(token)).send({ companyName: "Outra", phone: "11988887777" }).expect(409);
    expect(dup.body.error.message).toMatch(/Barbearia Alfa/);
  });

  it("pesquisa por nome e por telefone e filtra por cidade", async () => {
    const { token } = await registerAndLogin();
    await newLead(token);
    await newLead(token, { companyName: "Pizzaria Beta", city: "Barueri", phone: "(11) 3333-2222", niche: "Pizzarias" });
    const byName = await api().get("/api/crm/leads?q=pizz").set(auth(token)).expect(200);
    expect(byName.body.map((l: { companyName: string }) => l.companyName)).toEqual(["Pizzaria Beta"]);
    const byPhone = await api().get("/api/crm/leads?q=3333-2222").set(auth(token)).expect(200);
    expect(byPhone.body).toHaveLength(1);
    const byCity = await api().get("/api/crm/leads?city=osasco").set(auth(token)).expect(200);
    expect(byCity.body.map((l: { companyName: string }) => l.companyName)).toEqual(["Barbearia Alfa"]);
  });
});

describe("Kanban", () => {
  it("mover entre colunas persiste, registra a timeline e alimenta o dashboard", async () => {
    const { token } = await registerAndLogin();
    const s = await stages(token);
    const lead = await newLead(token);
    await api().post(`/api/crm/leads/${lead.id}/move`).set(auth(token)).send({ stageId: s.meeting, index: 0 }).expect(200);
    await api().post(`/api/crm/leads/${lead.id}/move`).set(auth(token)).send({ stageId: s.won, index: 0 }).expect(200);

    const detail = await api().get(`/api/crm/leads/${lead.id}`).set(auth(token)).expect(200);
    expect(detail.body.stage.key).toBe("won");
    expect(detail.body.convertedAt).not.toBeNull();
    const types = detail.body.activities.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(["STAGE_CHANGED", "MEETING_SCHEDULED", "CONVERTED"]));

    const dash = await api().get("/api/dashboard/summary?days=7").set(auth(token)).expect(200);
    expect(dash.body.cards).toMatchObject({ converted: 1, meetings: 1 });
  });

  it("reordena dentro da coluna", async () => {
    const { token } = await registerAndLogin();
    const s = await stages(token);
    const a = await newLead(token, { companyName: "Lead A", phone: null });
    const b = await newLead(token, { companyName: "Lead B", phone: null });
    const c = await newLead(token, { companyName: "Lead C", phone: null });
    // Ordem inicial: mais novo no topo (C, B, A). Move A para o topo.
    await api().post(`/api/crm/leads/${a.id}/move`).set(auth(token)).send({ stageId: s.new, index: 0 }).expect(200);
    const list = await api().get("/api/crm/leads").set(auth(token)).expect(200);
    expect(list.body.map((l: { companyName: string }) => l.companyName)).toEqual(["Lead A", "Lead C", "Lead B"]);
    expect(b.id && c.id).toBeTruthy();
  });

  it("não move para etapa de outra organização", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const lead = await newLead(a.token);
    const sb = await stages(b.token);
    await api().post(`/api/crm/leads/${lead.id}/move`).set(auth(a.token)).send({ stageId: sb.won, index: 0 }).expect(400);
    await api().get(`/api/crm/leads/${lead.id}`).set(auth(b.token)).expect(404);
    await api().delete(`/api/crm/leads/${lead.id}`).set(auth(b.token)).expect(404);
  });
});

describe("notas, contatos, tarefas e etiquetas", () => {
  it("registra tudo na timeline do lead", async () => {
    const { token } = await registerAndLogin();
    const lead = await newLead(token);
    const note = await api().post(`/api/crm/leads/${lead.id}/notes`).set(auth(token)).send({ body: "Dono atende à tarde" }).expect(201);
    await api().post(`/api/crm/leads/${lead.id}/activities`).set(auth(token)).send({ type: "MESSAGE_SENT" }).expect(201);
    await api().post(`/api/crm/leads/${lead.id}/activities`).set(auth(token)).send({ type: "INTEREST_SHOWN" }).expect(201);
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const task = await api().post("/api/crm/tasks").set(auth(token)).send({ leadId: lead.id, title: "Follow-up em 3 dias", dueAt: due }).expect(201);
    await api().patch(`/api/crm/tasks/${task.body.id}`).set(auth(token)).send({ status: "DONE" }).expect(200);
    const tag = await api().post("/api/crm/tags").set(auth(token)).send({ name: "Quente", color: "#EF4444" }).expect(201);
    await api().post("/api/crm/tags").set(auth(token)).send({ name: "Quente" }).expect(409);
    await api().patch(`/api/crm/leads/${lead.id}`).set(auth(token)).send({ tagIds: [tag.body.id] }).expect(200);

    const d = (await api().get(`/api/crm/leads/${lead.id}`).set(auth(token)).expect(200)).body;
    expect(d.notes[0].body).toBe("Dono atende à tarde");
    expect(d.interest).toBe("HIGH");
    expect(d.lastContactAt).not.toBeNull();
    expect(d.tags[0].name).toBe("Quente");
    expect(d.tasks[0].status).toBe("DONE");
    expect(d.activities.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining(["NOTE_ADDED", "MESSAGE_SENT", "INTEREST_SHOWN", "TASK_CREATED", "TASK_COMPLETED"]),
    );

    await api().delete(`/api/crm/leads/${lead.id}/notes/${note.body.id}`).set(auth(token)).expect(204);
    const filtered = await api().get(`/api/crm/leads?tagId=${tag.body.id}`).set(auth(token)).expect(200);
    expect(filtered.body).toHaveLength(1);
  });

  it("não aceita etiqueta ou responsável de outra organização", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const tagB = await api().post("/api/crm/tags").set(auth(b.token)).send({ name: "X" }).expect(201);
    const lead = await newLead(a.token);
    await api().patch(`/api/crm/leads/${lead.id}`).set(auth(a.token)).send({ tagIds: [tagB.body.id] }).expect(400);
    await api().patch(`/api/crm/leads/${lead.id}`).set(auth(a.token)).send({ ownerId: b.userId }).expect(400);
  });
});

describe("Encontrar Leads → CRM", () => {
  it("mostra prévia de duplicidade e importa só os novos", async () => {
    const { token, organizationId } = await registerAndLogin();
    const jobId = await seedSearch(organizationId, 4);
    const res = await api().get(`/api/crm/searches/${jobId}/results?pageSize=10`).set(auth(token)).expect(200);
    expect(res.body.total).toBe(4);
    const ids = res.body.rows.map((r: { id: string }) => r.id);

    const first = await api().post("/api/crm/import").set(auth(token)).send({ resultIds: ids.slice(0, 2) }).expect(200);
    expect(first.body).toEqual({ created: 2, duplicates: 0 });

    const preview = await api().post("/api/crm/import/preview").set(auth(token)).send({ resultIds: ids }).expect(200);
    expect(preview.body.toAdd).toBe(2);
    expect(preview.body.alreadyInCrm).toHaveLength(2);

    const second = await api().post("/api/crm/import").set(auth(token)).send({ resultIds: ids }).expect(200);
    expect(second.body).toEqual({ created: 2, duplicates: 2 });
    expect(await prisma.lead.count()).toBe(4);

    const after = await api().get(`/api/crm/searches/${jobId}/results`).set(auth(token)).expect(200);
    expect(after.body.rows.every((r: { lead: unknown }) => r.lead !== null)).toBe(true);
  });

  it("não importa resultados de outra organização", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const jobId = await seedSearch(a.organizationId, 1);
    const r = await prisma.searchResult.findFirstOrThrow({ where: { searchJobId: jobId } });
    await api().post("/api/crm/import").set(auth(b.token)).send({ resultIds: [r.id] }).expect(400);
    await api().get(`/api/crm/searches/${jobId}/results`).set(auth(b.token)).expect(404);
  });

  it("apaga resultados não importados com mais de 30 dias (política do Google)", async () => {
    const { organizationId } = await registerAndLogin();
    const jobId = await seedSearch(organizationId, 2);
    await prisma.searchResult.updateMany({ where: { searchJobId: jobId }, data: { createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await purgeExpiredSearchResults()).toBe(2);
  });
});

describe("telefone", () => {
  it("normaliza para E.164", () => {
    expect(phoneToE164("(11) 98888-7777")).toBe("+5511988887777");
    expect(phoneToE164("+55 11 3333-2222")).toBe("+551133332222");
    expect(phoneToE164("123")).toBeNull();
  });
});
