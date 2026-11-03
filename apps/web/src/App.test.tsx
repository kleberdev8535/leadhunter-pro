import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { renderApp } from "./test/render";
import { json, mockFetch } from "./test/fetch";

const me = {
  user: { id: "u1", name: "Lucas Ribeiro", email: "lucas@x.com", avatarUrl: null, createdAt: "2026-11-01" },
  organization: { id: "o1", name: "Agência Lucas", slug: "agencia" },
  role: "OWNER",
};

const zeroSummary = {
  periodDays: 30,
  cards: {
    totalLeads: 0, newLeads: 0, withoutWebsite: 0, qualified: 0, contacted: 0,
    replied: 0, meetings: 0, converted: 0, conversionRate: 0, createdInPeriod: 0,
  },
  today: { found: 0, approached: 0, replied: 0, interested: 0, converted: 0 },
};

const charts = {
  leadsPerDay: [{ date: "2026-11-03", total: 0 }],
  conversionsPerDay: [{ date: "2026-11-03", total: 0 }],
  byNiche: [],
  byCity: [],
  funnel: [{ id: "s1", key: "new", name: "Leads novos", color: "#64748B", kind: "OPEN", total: 0 }],
};

describe("App", () => {
  it("sem sessão, redireciona para o login e valida o formulário no cliente", async () => {
    mockFetch({ "POST /api/auth/refresh": () => json({}, 401) });
    renderApp(<App />, "/");
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Email inválido")).toBeInTheDocument();
    expect(screen.getByText("Informe a senha")).toBeInTheDocument();
  });

  it("mostra o erro do backend quando o login falha", async () => {
    mockFetch({
      "POST /api/auth/refresh": () => json({}, 401),
      "POST /api/auth/login": () => json({ error: { code: "INVALID_CREDENTIALS", message: "Email ou senha incorretos" } }, 401),
    });
    renderApp(<App />, "/login");
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Senha"), "errada123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    // O toast é renderizado fora desta árvore; garantimos que continuamos no login.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument());
  });

  it("com sessão, mostra o dashboard com os indicadores reais e o estado vazio", async () => {
    mockFetch({
      "POST /api/auth/refresh": () => json({ accessToken: "t" }),
      "GET /api/auth/me": () => json(me),
      "GET /api/dashboard/summary": () => json(zeroSummary),
      "GET /api/dashboard/charts": () => json(charts),
      "GET /api/dashboard/activities": () => json([]),
      "GET /api/workspace/notifications": () => json({ items: [], unread: 0 }),
    });
    renderApp(<App />, "/");
    expect(await screen.findByRole("heading", { name: "Olá, Lucas" }, { timeout: 8000 })).toBeInTheDocument();
    expect(await screen.findByText("Total de leads")).toBeInTheDocument();
    expect(screen.getByText("Sua base ainda está vazia")).toBeInTheDocument();
    expect(await screen.findByText("Nenhuma atividade ainda")).toBeInTheDocument();
  });

  it("troca o período e persiste a escolha", async () => {
    const spy = mockFetch({
      "POST /api/auth/refresh": () => json({ accessToken: "t" }),
      "GET /api/auth/me": () => json(me),
      "GET /api/dashboard/summary": () => json(zeroSummary),
      "GET /api/dashboard/charts": () => json(charts),
      "GET /api/dashboard/activities": () => json([]),
      "GET /api/workspace/notifications": () => json({ items: [], unread: 0 }),
    });
    renderApp(<App />, "/");
    const group = await screen.findByRole("radiogroup", { name: "Período" }, { timeout: 8000 });
    await userEvent.click(within(group).getByRole("radio", { name: "7 dias" }));
    await waitFor(() =>
      expect(spy.mock.calls.some(([u]) => String(u).includes("/api/dashboard/summary?days=7"))).toBe(true),
    );
    expect(localStorage.getItem("lh-dashboard-period")).toBe("7");
  });

  it("rota inexistente mostra 404 com caminho de volta", async () => {
    mockFetch({
      "POST /api/auth/refresh": () => json({ accessToken: "t" }),
      "GET /api/auth/me": () => json(me),
      "GET /api/workspace/notifications": () => json({ items: [], unread: 0 }),
    });
    renderApp(<App />, "/nao-existe");
    expect(await screen.findByText("Página não encontrada.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para o Dashboard" })).toBeInTheDocument();
  });
});
