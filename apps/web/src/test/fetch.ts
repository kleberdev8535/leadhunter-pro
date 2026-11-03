import { vi } from "vitest";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Substitui o fetch por rotas declaradas no teste; rota não declarada falha o teste. */
export function mockFetch(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && url.startsWith(p!);
    });
    if (!key) throw new Error(`fetch não mockado: ${method} ${url}`);
    return routes[key]!(url, init);
  });
}
