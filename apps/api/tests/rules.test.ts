import { describe, expect, it } from "vitest";
import { scoreLead } from "../src/agents/workers/scoring.js";
import { renderTemplate } from "../src/agents/workers/writer.worker.js";
import { component, toE164 } from "../src/integrations/google-places/places.client.js";
import { backoffMs } from "../src/tasks/task.errors.js";

const base = {
  website: null, websiteReported: null, phoneE164: null, phone: null, niche: null, city: null,
  rating: null, reviewCount: null, replied: false, interested: false,
};

describe("score do Scout", () => {
  it("lead sem nenhum dado útil fica em baixo potencial", () => {
    expect(scoreLead({ ...base, website: "https://x.com" }, { favoriteNiches: [], targetCities: [] })).toMatchObject({ score: 0, tier: "baixo" });
  });

  it("explica cada ponto e respeita o teto de 100", () => {
    const r = scoreLead(
      { ...base, phone: "11 9999", niche: "Barbearias", city: "Osasco", rating: 4.8, reviewCount: 100, replied: true, interested: true },
      { favoriteNiches: ["barbearias"], targetCities: ["OSASCO"] },
    );
    expect(r.score).toBe(100);
    expect(r.tier).toBe("alto");
    expect(r.reasons.map((x) => x.reason)).toContain("Nicho entre os favoritos");
  });

  it("não marca como 'não tem site' de forma categórica", () => {
    const r = scoreLead(base, { favoriteNiches: [], targetCities: [] });
    expect(r.reasons[0]!.reason).toMatch(/Nenhum site informado no Google/);
  });
});

describe("templates do Writer", () => {
  const vars = { empresa: "Barbearia Alfa", cidade: "Osasco", remetente: "Lucas", servico: "criação de sites", temSite: false };
  it("personaliza só com dados existentes", () => {
    const msg = renderTemplate("INITIAL", vars);
    expect(msg).toContain("Barbearia Alfa");
    expect(msg).toContain("Osasco");
    expect(msg).toContain("Lucas");
  });
  it("mensagem de 'sem site' vira mensagem inicial se a empresa tem site", () => {
    expect(renderTemplate("NO_WEBSITE", { ...vars, temSite: true })).toBe(renderTemplate("INITIAL", { ...vars, temSite: true }));
  });
  it("não diz que viu no Google quando o lead foi cadastrado à mão", () => {
    const manual = renderTemplate("INITIAL", { ...vars, doGoogle: false });
    expect(manual).not.toMatch(/Google/);
    expect(renderTemplate("NO_WEBSITE", { ...vars, doGoogle: false })).not.toMatch(/Google/);
    expect(renderTemplate("NO_WEBSITE", vars)).toMatch(/não encontrei um site informado/);
  });
  it("omite a cidade quando não existe, em vez de inventar", () => {
    expect(renderTemplate("INITIAL", { ...vars, cidade: null })).not.toContain("aqui em");
  });
});

describe("utilitários", () => {
  it("lê componentes de endereço mesmo quando o Google omite types", () => {
    const place = { id: "x", addressComponents: [{ longText: "Av. dos Autonomistas, 1828 - Vila Yara" }, { longText: "Osasco", types: ["administrative_area_level_2"] }] };
    expect(component(place, "administrative_area_level_2")).toBe("Osasco");
    expect(component(place, "sublocality")).toBeUndefined();
  });
  it("normaliza telefones brasileiros", () => {
    expect(toE164({ id: "x", nationalPhoneNumber: "(11) 98765-4321" })).toBe("+5511987654321");
    expect(toE164({ id: "x", internationalPhoneNumber: "+55 11 3333-4444" })).toBe("+551133334444");
    expect(toE164({ id: "x" })).toBeUndefined();
  });
  it("backoff exponencial com teto", () => {
    expect([0, 1, 2].map(backoffMs)).toEqual([5000, 10000, 20000]);
    expect(backoffMs(20)).toBe(300000);
  });
});
