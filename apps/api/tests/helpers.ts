import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let seq = 0;
export function newUser(overrides: Partial<{ name: string; email: string; password: string; organizationName: string }> = {}) {
  seq += 1;
  return {
    name: "Lucas Teste",
    email: `user${seq}-${Date.now()}@teste.com`,
    password: "SenhaForte123",
    organizationName: `Agência ${seq}`,
    ...overrides,
  };
}

export function refreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("lh_rt="));
  if (!cookie) throw new Error("cookie de refresh ausente");
  return cookie.split(";")[0]!;
}

export async function registerAndLogin(overrides = {}) {
  const input = newUser(overrides);
  const res = await api().post("/api/auth/register").send(input).expect(201);
  const me = await api().get("/api/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);
  return {
    input,
    token: res.body.accessToken as string,
    cookie: refreshCookie(res),
    userId: me.body.user.id as string,
    organizationId: me.body.organization.id as string,
  };
}
