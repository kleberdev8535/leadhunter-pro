/**
 * Regras de qualificação do Scout. Cada ponto vem de um dado que existe no lead; nada é inferido
 * sobre faturamento, porte ou necessidade. As razões são mostradas ao usuário como estão aqui.
 */
export interface ScoringInput {
  website: string | null;
  websiteReported: boolean | null;
  phoneE164: string | null;
  phone: string | null;
  niche: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  replied: boolean;
  interested: boolean;
}

export interface ScoringConfig {
  favoriteNiches: string[];
  targetCities: string[];
}

export interface ScoreResult {
  score: number;
  tier: "baixo" | "médio" | "alto";
  reasons: { points: number; reason: string }[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function scoreLead(lead: ScoringInput, config: ScoringConfig): ScoreResult {
  const reasons: ScoreResult["reasons"] = [];
  const add = (points: number, reason: string) => reasons.push({ points, reason });

  if (!lead.website) add(25, "Nenhum site informado no Google (confirmar antes de abordar)");
  if (lead.phoneE164 || lead.phone) add(20, "Telefone disponível");
  if (lead.niche && config.favoriteNiches.some((n) => norm(n) === norm(lead.niche!))) add(15, "Nicho entre os favoritos");
  if (lead.city && config.targetCities.some((c) => norm(c) === norm(lead.city!))) add(10, "Cidade-alvo");
  if (lead.rating !== null && lead.rating >= 4) add(5, `Avaliação ${lead.rating.toFixed(1)} no Google`);
  if (lead.reviewCount !== null && lead.reviewCount >= 20) add(5, `${lead.reviewCount} avaliações (negócio ativo)`);
  if (lead.replied) add(10, "Já respondeu a um contato");
  if (lead.interested) add(10, "Demonstrou interesse");

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const tier = score >= 60 ? "alto" : score >= 35 ? "médio" : "baixo";
  return { score, tier, reasons };
}
