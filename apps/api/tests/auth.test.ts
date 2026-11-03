import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, newUser, refreshCookie, registerAndLogin, resetDb } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { testOutbox } from "../src/lib/mailer.js";

const CLIENT = { "x-lh-client": "web" };

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("cadastro", () => {
  it("cria usuário, organização, funil padrão com 9 etapas e devolve tokens", async () => {
    const input = newUser();
    const res = await api().post("/api/auth/register").send(input).expect(201);
    expect(res.body.accessToken).toBeTypeOf("string");
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/^lh_rt=/);
    expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly/i);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email }, include: { memberships: true } });
    expect(user.passwordHash).not.toContain(input.password);
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.memberships[0]?.role).toBe("OWNER");
    const stages = await prisma.pipelineStage.findMany({ where: { organizationId: user.memberships[0]!.organizationId } });
    expect(stages).toHaveLength(9);
  });

  it("rejeita email duplicado com 409", async () => {
    const input = newUser();
    await api().post("/api/auth/register").send(input).expect(201);
    const res = await api().post("/api/auth/register").send({ ...input, email: input.email.toUpperCase() }).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("valida entrada e devolve detalhes por campo", async () => {
    const res = await api()
      .post("/api/auth/register")
      .send({ name: "A", email: "nao-é-email", password: "123", organizationName: "" })
      .expect(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "email", "password", "organizationName"]));
  });

  it("responde 400 para JSON malformado", async () => {
    await api().post("/api/auth/login").set("Content-Type", "application/json").send("{oops").expect(400);
  });
});

describe("login e bloqueio por força bruta", () => {
  it("faz login com credenciais corretas", async () => {
    const { input } = await registerAndLogin();
    const res = await api().post("/api/auth/login").send({ email: input.email, password: input.password }).expect(200);
    expect(res.body.accessToken).toBeTypeOf("string");
  });

  it("não revela se o email existe", async () => {
    const { input } = await registerAndLogin();
    const wrongPass = await api().post("/api/auth/login").send({ email: input.email, password: "errada123" }).expect(401);
    const noUser = await api().post("/api/auth/login").send({ email: "ninguem@x.com", password: "errada123" }).expect(401);
    expect(wrongPass.body.error.message).toBe(noUser.body.error.message);
  });

  it("bloqueia a conta após 5 tentativas erradas, mesmo com a senha certa depois", async () => {
    const { input } = await registerAndLogin();
    for (let i = 0; i < 4; i++) {
      await api().post("/api/auth/login").send({ email: input.email, password: "errada123" }).expect(401);
    }
    const fifth = await api().post("/api/auth/login").send({ email: input.email, password: "errada123" }).expect(429);
    expect(fifth.body.error.code).toBe("ACCOUNT_LOCKED");
    await api().post("/api/auth/login").send({ email: input.email, password: input.password }).expect(429);
    const logs = await prisma.auditLog.count({ where: { action: "auth.login_failed" } });
    expect(logs).toBe(4);
  });
});

describe("rotas protegidas e sessão", () => {
  it("exige token", async () => {
    await api().get("/api/auth/me").expect(401);
    await api().get("/api/auth/me").set("Authorization", "Bearer token-falso").expect(401);
  });

  it("rotaciona o refresh token e revoga a sessão se um token antigo for reutilizado", async () => {
    const { cookie } = await registerAndLogin();
    const first = await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", cookie).expect(200);
    const newCookie = refreshCookie(first);
    expect(newCookie).not.toBe(cookie);

    // Fora da janela de tolerância, o token antigo é tratado como vazado.
    await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });
    const reuse = await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", cookie).expect(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSED");
    // A sessão inteira cai, inclusive o token novo.
    await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", newCookie).expect(401);
  });

  it("aceita o token anterior dentro da janela de tolerância (abas simultâneas)", async () => {
    const { cookie } = await registerAndLogin();
    await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", cookie).expect(200);
    await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", cookie).expect(200);
  });

  it("exige o header de cliente no refresh (proteção CSRF)", async () => {
    const { cookie } = await registerAndLogin();
    await api().post("/api/auth/refresh").set("Cookie", cookie).expect(403);
  });

  it("logout revoga a sessão e o access token deixa de valer imediatamente", async () => {
    const { cookie, token } = await registerAndLogin();
    await api().post("/api/auth/logout").set(CLIENT).set("Cookie", cookie).expect(204);
    await api().get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(401);
    await api().post("/api/auth/refresh").set(CLIENT).set("Cookie", cookie).expect(401);
  });

  it("lista e encerra sessões do próprio usuário", async () => {
    const { input, token } = await registerAndLogin();
    await api().post("/api/auth/login").send({ email: input.email, password: input.password }).expect(200);
    const list = await api().get("/api/auth/sessions").set("Authorization", `Bearer ${token}`).expect(200);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await api().delete(`/api/auth/sessions/${other.id}`).set("Authorization", `Bearer ${token}`).expect(204);
    const after = await api().get("/api/auth/sessions").set("Authorization", `Bearer ${token}`).expect(200);
    expect(after.body).toHaveLength(1);
  });

  it("não deixa encerrar sessão de outro usuário", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const sessionsB = await api().get("/api/auth/sessions").set("Authorization", `Bearer ${b.token}`).expect(200);
    await api().delete(`/api/auth/sessions/${sessionsB.body[0].id}`).set("Authorization", `Bearer ${a.token}`).expect(404);
  });
});

describe("recuperação e troca de senha", () => {
  it("envia link, redefine a senha, invalida o link e derruba as sessões", async () => {
    const { input, token } = await registerAndLogin();

    await api().post("/api/auth/forgot-password").send({ email: input.email }).expect(200);
    const text = testOutbox.at(-1)?.text ?? "";
    const resetToken = decodeURIComponent(/token=([^\s]+)/.exec(text)?.[1] ?? "");
    expect(resetToken.length).toBeGreaterThan(20);

    await api().post("/api/auth/reset-password").send({ token: resetToken, password: "NovaSenha456" }).expect(200);
    await api().post("/api/auth/reset-password").send({ token: resetToken, password: "OutraSenha789" }).expect(400);
    await api().get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(401);
    await api().post("/api/auth/login").send({ email: input.email, password: "NovaSenha456" }).expect(200);
  });

  it("responde igual para email inexistente", async () => {
    const res = await api().post("/api/auth/forgot-password").send({ email: "nao-existe@x.com" }).expect(200);
    expect(res.body.message).toMatch(/Se existir/);
  });

  it("troca a senha mantendo a sessão atual", async () => {
    const { input, token } = await registerAndLogin();
    await api()
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "errada123", newPassword: "NovaSenha456" })
      .expect(400);
    await api()
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: input.password, newPassword: "NovaSenha456" })
      .expect(200);
    await api().get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
  });
});
