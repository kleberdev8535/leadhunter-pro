import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getAccessToken, setAccessToken, setSessionLostHandler } from "./api";
import { json, mockFetch } from "@/test/fetch";

beforeEach(() => setAccessToken(null));

describe("cliente da API", () => {
  it("envia o access token e o header de cliente", async () => {
    setAccessToken("abc");
    const spy = mockFetch({ "GET /api/x": () => json({ ok: true }) });
    await api("/api/x");
    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer abc");
    expect(headers["x-lh-client"]).toBe("web");
  });

  it("renova o token uma única vez quando várias requisições recebem 401", async () => {
    setAccessToken("velho");
    let refreshCalls = 0;
    mockFetch({
      "POST /api/auth/refresh": async () => {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json({ accessToken: "novo" });
      },
      "GET /api/x": (_u, init) =>
        (init?.headers as Record<string, string>).Authorization === "Bearer novo" ? json({ ok: 1 }) : json({}, 401),
    });
    const results = await Promise.all([api("/api/x"), api("/api/x"), api("/api/x")]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
    expect(getAccessToken()).toBe("novo");
  });

  it("avisa quando a sessão não pode ser renovada", async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    mockFetch({
      "POST /api/auth/refresh": () => json({}, 401),
      "GET /api/x": () => json({ error: { code: "UNAUTHORIZED", message: "Não autenticado" } }, 401),
    });
    await expect(api("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledOnce();
  });

  it("converte o erro do backend em ApiError com detalhes", async () => {
    mockFetch({
      "POST /api/y": () =>
        json({ error: { code: "BAD_REQUEST", message: "Dados inválidos", details: [{ path: "email", message: "x" }] } }, 400),
    });
    const err = (await api("/api/y", { method: "POST", body: {} }).catch((e) => e)) as ApiError;
    expect(err.status).toBe(400);
    expect(err.details?.[0]?.path).toBe("email");
  });

  it("traduz falha de rede", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/api/z")).rejects.toMatchObject({ code: "NETWORK" });
  });
});
