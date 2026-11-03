import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { io as connect } from "socket.io-client";
import { api, app, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { TaskRunner, type HandlerMap } from "../src/tasks/services/task-runner.js";
import { PostgresTaskQueue } from "../src/tasks/queues/task-queue.js";
import { HANDLERS } from "../src/agents/workers/index.js";
import { officeEvents, type OfficeEvent } from "../src/office/events/office-events.js";
import { attachSocketGateway } from "../src/office/gateway/socket-gateway.js";
import type { FetchFn } from "../src/integrations/google-places/places.client.js";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const key = () => `k-${randomUUID()}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ── Google Places falso, só para os testes ──
function place(i: number, opts: { website?: boolean; phone?: boolean } = {}) {
  return {
    id: `place-${i}`,
    displayName: { text: `Barbearia ${i}` },
    formattedAddress: `Rua ${i}, Osasco - SP`,
    addressComponents: [
      { longText: "Osasco", shortText: "Osasco", types: ["administrative_area_level_2"] },
      { longText: "São Paulo", shortText: "SP", types: ["administrative_area_level_1"] },
    ],
    nationalPhoneNumber: opts.phone === false ? undefined : `(11) 9999-000${i}`,
    websiteUri: opts.website ? `https://barbearia${i}.com.br` : undefined,
    rating: 4.6,
    userRatingCount: 40,
    googleMapsUri: `https://maps.google.com/?cid=${i}`,
    businessStatus: "OPERATIONAL",
  };
}

function fakeGoogle(pages: unknown[][]): { fetch: FetchFn; calls: { url: string; body: string; headers: Record<string, string> }[] } {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ""), headers: init?.headers as Record<string, string> });
    const token = JSON.parse(String(init?.body ?? "{}")).pageToken as string | undefined;
    const idx = token ? Number(token) : 0;
    const body = { places: pages[idx] ?? [], nextPageToken: idx + 1 < pages.length ? String(idx + 1) : undefined };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as FetchFn;
  return { fetch, calls };
}

const runnerWith = (fetch?: FetchFn, handlers: HandlerMap = HANDLERS) =>
  new TaskRunner({ handlers, queue: new PostgresTaskQueue(), deps: fetch ? { fetch } : undefined });

async function drain(runner: TaskRunner, max = 20) {
  for (let i = 0; i < max && (await runner.runOnce()); i++);
}

const search = (overrides: Record<string, unknown> = {}) => ({
  taskType: "SEARCH_LEADS",
  idempotencyKey: key(),
  parameters: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 50, website: "without", ...overrides },
});

async function saveGoogleKey(token: string) {
  await api().put("/api/integrations/google-places").set(auth(token)).send({ apiKey: "AIzaSyTESTE_chave_valida_123456" }).expect(200);
}

describe("registro de agentes", () => {
  it("toda organização nova tem os 5 agentes disponíveis", async () => {
    const { token } = await registerAndLogin();
    const res = await api().get("/api/office/agents").set(auth(token)).expect(200);
    expect(res.body.map((a: { name: string }) => a.name)).toEqual(["Hunter", "Scout", "Atlas", "Writer", "Metrics"]);
    expect(res.body.every((a: { status: string }) => a.status === "AVAILABLE")).toBe(true);
    expect(res.body[0].supports).toContain("SEARCH_LEADS");
  });
});

describe("criação de tarefas", () => {
  it("valida os parâmetros estruturados", async () => {
    const { token } = await registerAndLogin();
    await api().post("/api/office/tasks").set(auth(token)).send(search({ quantity: 0 })).expect(400);
    await api().post("/api/office/tasks").set(auth(token)).send(search({ niches: ["cassinos"] })).expect(400);
    // Tipo de tarefa inexistente não chega a nenhum agente.
    await api().post("/api/office/tasks").set(auth(token)).send({ taskType: "RUN_SQL", idempotencyKey: key(), parameters: { sql: "drop table" } }).expect(400);
  });

  it("é idempotente: reenviar a mesma chave não cria outra tarefa", async () => {
    const { token } = await registerAndLogin();
    const body = search();
    const a = await api().post("/api/office/tasks").set(auth(token)).send(body).expect(201);
    const b = await api().post("/api/office/tasks").set(auth(token)).send(body).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.agentTask.count()).toBe(1);
    expect(a.body.title).toBe("Buscar 50 Barbearias sem site informado em Osasco/SP");
  });

  it("atribui ao agente certo, deixa o agente ASSIGNED e publica eventos", async () => {
    const { token } = await registerAndLogin();
    const events: OfficeEvent[] = [];
    const listener = (e: OfficeEvent) => events.push(e);
    officeEvents.on("event", listener);
    const res = await api().post("/api/office/tasks").set(auth(token)).send(search()).expect(201);
    officeEvents.off("event", listener);
    expect(res.body.agentName).toBe("Hunter");
    expect(res.body.status).toBe("QUEUED");
    const names = events.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["task:created", "task:queued", "agent:task_assigned", "agent:status_changed"]));
    const agents = await api().get("/api/office/agents").set(auth(token)).expect(200);
    expect(agents.body[0].status).toBe("ASSIGNED");
  });
});

describe("execução", () => {
  it("sem chave do Google a busca falha de forma clara e o agente fica em erro", async () => {
    const { token } = await registerAndLogin();
    const { body } = await api().post("/api/office/tasks").set(auth(token)).send(search()).expect(201);
    await drain(runnerWith());
    const task = await api().get(`/api/office/tasks/${body.id}`).set(auth(token)).expect(200);
    expect(task.body.status).toBe("FAILED");
    expect(task.body.errorMessage).toMatch(/Google Maps não configurado/);
    expect(task.body.retryCount).toBe(0); // erro permanente não é retentado
    const agents = await api().get("/api/office/agents").set(auth(token)).expect(200);
    expect(agents.body[0]).toMatchObject({ status: "ERROR", tasksFailed: 1 });
  });

  it("fluxo completo: Hunter busca → Atlas importa sem duplicar → Scout qualifica → Writer escreve → Metrics relata", async () => {
    const { token } = await registerAndLogin();
    await saveGoogleKey(token);
    const integ = await prisma.integration.findFirstOrThrow();
    expect(integ.encryptedCredentials).not.toContain("AIzaSy"); // chave só criptografada

    const google = fakeGoogle([
      [place(1), place(2, { website: true }), place(3)],
      [place(4), place(1)],
    ]);
    const runner = runnerWith(google.fetch);

    const s = await api().post("/api/office/tasks").set(auth(token)).send(search()).expect(201);
    await drain(runner);
    const done = await api().get(`/api/office/tasks/${s.body.id}`).set(auth(token)).expect(200);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.progress).toBe(100);
    expect(done.body.result).toMatchObject({ saved: 3, skippedByFilter: 1, requests: 2 }); // place-2 tem site; place-1 repetido
    expect(google.calls[0]!.headers["X-Goog-FieldMask"]).toContain("places.websiteUri");
    expect(JSON.parse(google.calls[0]!.body).textQuery).toBe("barbearia em Osasco - SP, Brasil");
    expect(done.body.logs.length).toBeGreaterThan(1);

    // Scout qualifica o que o Hunter encontrou ANTES do registro no CRM.
    await api().post("/api/office/tasks").set(auth(token))
      .send({ taskType: "QUALIFY_LEADS", idempotencyKey: key(), parameters: { source: { kind: "search", searchTaskId: s.body.id }, targetCities: ["Osasco"] } }).expect(201);
    await drain(runner);
    const scored = await prisma.searchResult.findFirstOrThrow({ where: { placeId: "place-1" } });
    expect((scored.data as { score: number }).score).toBe(65);

    const imp = await api().post("/api/office/tasks").set(auth(token))
      .send({ taskType: "IMPORT_TO_CRM", idempotencyKey: key(), parameters: { searchTaskId: s.body.id } }).expect(201);
    await drain(runner);
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: imp.body.id } })).result).toMatchObject({ created: 3, duplicates: 0 });
    const imp2 = await api().post("/api/office/tasks").set(auth(token))
      .send({ taskType: "IMPORT_TO_CRM", idempotencyKey: key(), parameters: { searchTaskId: s.body.id } }).expect(201);
    await drain(runner);
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: imp2.body.id } })).result).toMatchObject({ created: 0, duplicates: 3 });
    expect(await prisma.lead.count()).toBe(3);
    expect(await prisma.leadActivity.count({ where: { type: "LEAD_FOUND" } })).toBe(3);

    const lead = await prisma.lead.findFirstOrThrow({ where: { placeId: "place-1" }, include: { stage: true } });
    // sem site 25 + telefone 20 + cidade 10 + nota 5 + avaliações 5 → já entra como qualificado
    expect(lead.score).toBe(65);
    expect(lead.stage.key).toBe("qualified");
    expect(lead.scoreReasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "Telefone disponível" })]));

    const w = await api().post("/api/office/tasks").set(auth(token)).send({
      taskType: "GENERATE_MESSAGES", idempotencyKey: key(),
      parameters: { kind: "NO_WEBSITE", senderName: "Lucas", serviceOffered: "criação de sites", stageKey: "qualified", minScore: 60 },
    }).expect(201);
    await drain(runner);
    const drafts = ((await prisma.agentTask.findUniqueOrThrow({ where: { id: w.body.id } })).result as { drafts: { body: string }[]; sent: number });
    expect(drafts.drafts).toHaveLength(3);
    expect(drafts.sent).toBe(0);
    expect(drafts.drafts[0]!.body).toContain("Lucas");
    expect(drafts.drafts[0]!.body).not.toMatch(/analis/i); // nunca afirma análise que não houve

    const m = await api().post("/api/office/tasks").set(auth(token))
      .send({ taskType: "GENERATE_REPORT", idempotencyKey: key(), parameters: { days: 30 } }).expect(201);
    await drain(runner);
    const report = (await prisma.agentTask.findUniqueOrThrow({ where: { id: m.body.id } })).result as { cards: { totalLeads: number } };
    expect(report.cards.totalLeads).toBe(3);

    const agents = await api().get("/api/office/agents").set(auth(token)).expect(200);
    expect(agents.body.every((a: { status: string }) => a.status === "AVAILABLE")).toBe(true);
    expect(agents.body.find((a: { name: string }) => a.name === "Atlas").tasksCompleted).toBe(2);

    const usage = await api().get("/api/integrations/google-places").set(auth(token)).expect(200);
    expect(usage.body.usage.month.requests).toBe(2);
    expect(usage.body.credentialHint).toBe("…3456");
  });

  it("falha temporária do Google volta para a fila com backoff e depois falha de vez", async () => {
    const { token } = await registerAndLogin();
    await saveGoogleKey(token);
    const failing = (async () => new Response(JSON.stringify({ error: { message: "backend error" } }), { status: 503 })) as unknown as FetchFn;
    const runner = runnerWith(failing);
    const { body } = await api().post("/api/office/tasks").set(auth(token)).send(search()).expect(201);

    await runner.runOnce();
    let t = await prisma.agentTask.findUniqueOrThrow({ where: { id: body.id } });
    expect(t).toMatchObject({ status: "QUEUED", retryCount: 1 });
    expect(t.runAfter.getTime()).toBeGreaterThan(Date.now() + 3000);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: t.agentId } })).status).toBe("WAITING");
    expect(await runner.runOnce()).toBe(false); // ainda dentro do backoff

    for (let i = 0; i < 3; i++) {
      await prisma.agentTask.update({ where: { id: body.id }, data: { runAfter: new Date() } });
      await runner.runOnce();
    }
    t = await prisma.agentTask.findUniqueOrThrow({ where: { id: body.id } });
    expect(t).toMatchObject({ status: "FAILED", retryCount: 3 });
  });
});

describe("controle: pausar, retomar, cancelar, reexecutar", () => {
  const slow: HandlerMap = {
    ...HANDLERS,
    GENERATE_REPORT: async (ctx) => {
      const start = (ctx.task.checkpoint as { step?: number }).step ?? 0;
      for (let step = start; step < 4; step++) await ctx.progress((step + 1) * 25, { step: step + 1 });
      return { resumedFrom: start };
    },
  };
  const report = () => ({ taskType: "GENERATE_REPORT", idempotencyKey: key(), parameters: { days: 7 } });

  it("pausa e cancela tarefas na fila imediatamente", async () => {
    const { token } = await registerAndLogin();
    const a = await api().post("/api/office/tasks").set(auth(token)).send(report()).expect(201);
    await api().post(`/api/office/tasks/${a.body.id}/pause`).set(auth(token)).expect(200);
    expect(await runnerWith(undefined, slow).runOnce()).toBe(false); // pausada não executa
    const r = await api().post(`/api/office/tasks/${a.body.id}/resume`).set(auth(token)).expect(200);
    expect(r.body.status).toBe("QUEUED");
    const c = await api().post(`/api/office/tasks/${a.body.id}/cancel`).set(auth(token)).expect(200);
    expect(c.body.status).toBe("CANCELLED");
    await api().post(`/api/office/tasks/${a.body.id}/resume`).set(auth(token)).expect(409);
  });

  it("tarefa em execução para no checkpoint e retoma de onde parou", async () => {
    const { token } = await registerAndLogin();
    const a = await api().post("/api/office/tasks").set(auth(token)).send(report()).expect(201);
    const runner = runnerWith(undefined, slow);
    // Simula o usuário clicando em pausar durante a execução: o pedido é feito após o 2º passo.
    let calls = 0;
    const listener = async (e: OfficeEvent) => {
      if (e.name === "task:progress" && ++calls === 2) await prisma.agentTask.update({ where: { id: a.body.id }, data: { controlRequest: "pause" } });
    };
    officeEvents.on("event", listener);
    await runner.runOnce();
    officeEvents.off("event", listener);

    let t = await prisma.agentTask.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(t.status).toBe("PAUSED");
    expect((t.checkpoint as { step: number }).step).toBeGreaterThanOrEqual(2);

    await api().post(`/api/office/tasks/${a.body.id}/resume`).set(auth(token)).expect(200);
    await runner.runOnce();
    t = await prisma.agentTask.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(t.status).toBe("COMPLETED");
    expect((t.result as { resumedFrom: number }).resumedFrom).toBeGreaterThanOrEqual(2);
  });

  it("cancelamento em execução é obedecido e reexecutar cria uma nova tarefa", async () => {
    const { token } = await registerAndLogin();
    const a = await api().post("/api/office/tasks").set(auth(token)).send(report()).expect(201);
    await prisma.agentTask.update({ where: { id: a.body.id }, data: { status: "QUEUED" } });
    const runner = runnerWith(undefined, slow);
    const listener = async (e: OfficeEvent) => {
      if (e.name === "task:started") await prisma.agentTask.update({ where: { id: a.body.id }, data: { controlRequest: "cancel" } });
    };
    officeEvents.on("event", listener);
    await runner.runOnce();
    officeEvents.off("event", listener);
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: a.body.id } })).status).toBe("CANCELLED");

    const retry = await api().post(`/api/office/tasks/${a.body.id}/retry`).set(auth(token)).send({ idempotencyKey: key() }).expect(201);
    expect(retry.body.id).not.toBe(a.body.id);
    expect(retry.body.status).toBe("QUEUED");
  });

  it("pausar o agente impede que ele pegue tarefas", async () => {
    const { token } = await registerAndLogin();
    const agents = await api().get("/api/office/agents").set(auth(token)).expect(200);
    const metrics = agents.body.find((x: { name: string }) => x.name === "Metrics");
    await api().patch(`/api/office/agents/${metrics.id}`).set(auth(token)).send({ paused: true }).expect(200);
    await api().post("/api/office/tasks").set(auth(token)).send(report()).expect(201);
    expect(await runnerWith(undefined, slow).runOnce()).toBe(false);
    const again = await api().get("/api/office/agents").set(auth(token)).expect(200);
    expect(again.body.find((x: { name: string }) => x.name === "Metrics").status).toBe("PAUSED");
  });
});

describe("concorrência", () => {
  it("dois workers nunca executam duas tarefas do mesmo agente ao mesmo tempo", async () => {
    const { token } = await registerAndLogin();
    for (let i = 0; i < 3; i++) {
      await api().post("/api/office/tasks").set(auth(token)).send({ taskType: "GENERATE_REPORT", idempotencyKey: key(), parameters: { days: 7 } }).expect(201);
    }
    const q = new PostgresTaskQueue();
    const claimed = await Promise.all([q.claimNext("w1"), q.claimNext("w2"), q.claimNext("w3")]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await prisma.agentTask.count({ where: { status: "RUNNING" } })).toBe(1);
  });

  it("devolve à fila tarefas de um worker que morreu", async () => {
    const { token } = await registerAndLogin();
    await api().post("/api/office/tasks").set(auth(token)).send({ taskType: "GENERATE_REPORT", idempotencyKey: key(), parameters: { days: 7 } }).expect(201);
    const q = new PostgresTaskQueue();
    const t = await q.claimNext("morto");
    await prisma.agentTask.update({ where: { id: t!.id }, data: { lockedAt: new Date(Date.now() - 20 * 60_000) } });
    expect(await q.recoverStale(10 * 60_000)).toBe(1);
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: t!.id } })).status).toBe("QUEUED");
  });
});

describe("isolamento entre organizações", () => {
  it("uma organização não vê nem usa tarefas de outra", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const t = await api().post("/api/office/tasks").set(auth(a.token)).send(search()).expect(201);
    await prisma.agentTask.update({ where: { id: t.body.id }, data: { status: "COMPLETED", result: { searchJobId: randomUUID() } } });

    await api().get(`/api/office/tasks/${t.body.id}`).set(auth(b.token)).expect(404);
    await api().post(`/api/office/tasks/${t.body.id}/cancel`).set(auth(b.token)).expect(404);
    const list = await api().get("/api/office/tasks").set(auth(b.token)).expect(200);
    expect(list.body).toHaveLength(0);
    await api().post("/api/office/tasks").set(auth(b.token))
      .send({ taskType: "IMPORT_TO_CRM", idempotencyKey: key(), parameters: { searchTaskId: t.body.id } }).expect(400);
  });
});

describe("tempo real (Socket.IO)", () => {
  it("entrega eventos só para a organização certa e recusa token inválido", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const server = createServer(app);
    const gateway = attachSocketGateway(server);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    const opts = { path: "/api/socket.io", transports: ["websocket"], reconnection: false };

    const sa = connect(url, { ...opts, auth: { token: a.token } });
    const sb = connect(url, { ...opts, auth: { token: b.token } });
    const bad = connect(url, { ...opts, auth: { token: "falso" } });
    const badErrorP = new Promise<Error>((r) => bad.on("connect_error", r));
    await Promise.all([new Promise<void>((r) => sa.on("connect", () => r())), new Promise<void>((r) => sb.on("connect", () => r()))]);
    const badError = await badErrorP;
    expect(badError.message).toBe("UNAUTHORIZED");

    const receivedB: unknown[] = [];
    sb.on("task:created", (e) => receivedB.push(e));
    const gotA = new Promise<{ task: { id: string } }>((r) => sa.on("task:created", r));
    const res = await api().post("/api/office/tasks").set(auth(a.token)).send(search()).expect(201);
    expect((await gotA).task.id).toBe(res.body.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(receivedB).toHaveLength(0);

    sa.close();
    sb.close();
    bad.close();
    await gateway.close();
    await new Promise((r) => server.close(r));
  });
});

describe("missão da equipe", () => {
  it("Hunter → Scout → Atlas → Writer → Metrics em sequência, sem intervenção", async () => {
    const { token, organizationId } = await registerAndLogin();
    await saveGoogleKey(token);
    await prisma.aIConfiguration.create({ data: { organizationId, model: "templates", senderName: "Lucas", serviceOffered: "criação de sites" } });
    const google = fakeGoogle([[place(1), place(2, { phone: false }), place(3, { website: true })]]);
    const runner = runnerWith(google.fetch);

    const started = await api().post("/api/office/team-runs").set(auth(token)).send({
      search: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 10, website: "any" },
      minScore: 42,
      messageKind: "NO_WEBSITE",
      idempotencyKey: key(),
    }).expect(201);
    expect(started.body.steps.map((s: { key: string }) => s.key)).toEqual(["hunter", "scout", "atlas", "writer", "metrics"]);

    // Cada drain executa o que está pronto; os passos seguintes nascem quando o anterior conclui.
    const order: string[] = [];
    for (let i = 0; i < 10 && (await runner.runOnce()); i++) {
      const last = await prisma.agentTask.findFirstOrThrow({ where: { teamRunId: started.body.id, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, include: { agent: true } });
      order.push(last.agent.name);
    }
    expect(order).toEqual(["Hunter", "Scout", "Atlas", "Writer", "Metrics"]);

    const run = (await api().get(`/api/office/team-runs/${started.body.id}`).set(auth(token)).expect(200)).body;
    expect(run.status).toBe("COMPLETED");
    // place-1 = 65, place-2 = 45 (sem site, sem telefone), place-3 = 40 (tem site) → só os dois primeiros passam de 42
    expect(run.summary.atlas).toMatchObject({ created: 2, skipped: 1 });
    const leads = await prisma.lead.findMany({ include: { stage: true } });
    const p1 = leads.find((l) => l.placeId === "place-1")!;
    expect(p1.stage.key).toBe("qualified");
    expect(await prisma.leadActivity.count({ where: { type: "MESSAGE_PREPARED" } })).toBe(leads.length);
    const draft = await prisma.leadActivity.findFirstOrThrow({ where: { type: "MESSAGE_PREPARED", leadId: p1.id } });
    expect((draft.metadata as { body: string }).body).toMatch(/não encontrei um site informado/);
  });

  it("missão para no Hunter quando o Google não encontra nada, e cancelamento interrompe a sequência", async () => {
    const { token, organizationId } = await registerAndLogin();
    await saveGoogleKey(token);
    const runner = runnerWith(fakeGoogle([[]]).fetch);
    const r1 = await api().post("/api/office/team-runs").set(auth(token)).send({
      search: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 10 }, writeMessages: false, idempotencyKey: key(),
    }).expect(201);
    await drain(runner);
    const done = (await api().get(`/api/office/team-runs/${r1.body.id}`).set(auth(token))).body;
    expect(done.status).toBe("COMPLETED");
    expect(done.summary.note).toMatch(/não retornou empresas/);
    expect(await prisma.agentTask.count({ where: { teamRunId: r1.body.id } })).toBe(1);

    const r2 = await api().post("/api/office/team-runs").set(auth(token)).send({
      search: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 10 }, writeMessages: false, idempotencyKey: key(),
    }).expect(201);
    await api().post(`/api/office/team-runs/${r2.body.id}/cancel`).set(auth(token)).expect(200);
    await drain(runner);
    expect((await api().get(`/api/office/team-runs/${r2.body.id}`).set(auth(token))).body.status).toBe("CANCELLED");
    expect(await prisma.agentTask.count({ where: { teamRunId: r2.body.id } })).toBe(1);
    expect(organizationId).toBeTruthy();
  });

  it("exige perfil comercial quando o Writer participa", async () => {
    const { token } = await registerAndLogin();
    const r = await api().post("/api/office/team-runs").set(auth(token)).send({
      search: { niches: ["barbearias"], city: "Osasco", state: "SP", quantity: 10 }, idempotencyKey: key(),
    }).expect(400);
    expect(r.body.error.message).toMatch(/Configurações → Prospecção/);
  });
});
