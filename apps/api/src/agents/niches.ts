/** Nichos pré-configurados. `query` é o termo usado na busca textual do Google Places. */
export const NICHES = [
  { key: "barbearias", label: "Barbearias", query: "barbearia" },
  { key: "saloes", label: "Salões de beleza", query: "salão de beleza" },
  { key: "odonto", label: "Clínicas odontológicas", query: "clínica odontológica" },
  { key: "clinicas", label: "Clínicas médicas", query: "clínica médica" },
  { key: "academias", label: "Academias", query: "academia" },
  { key: "personal", label: "Personal trainers", query: "personal trainer" },
  { key: "restaurantes", label: "Restaurantes", query: "restaurante" },
  { key: "pizzarias", label: "Pizzarias", query: "pizzaria" },
  { key: "oficinas", label: "Oficinas mecânicas", query: "oficina mecânica" },
  { key: "roupas", label: "Lojas de roupas", query: "loja de roupas" },
  { key: "imobiliarias", label: "Imobiliárias", query: "imobiliária" },
  { key: "advogados", label: "Advogados", query: "escritório de advocacia" },
  { key: "contabilidades", label: "Contabilidades", query: "contabilidade" },
  { key: "petshops", label: "Pet shops", query: "pet shop" },
  { key: "escolas", label: "Escolas", query: "escola" },
  { key: "servicos", label: "Empresas de serviços", query: "empresa de serviços" },
  { key: "tecnologia", label: "Empresas de tecnologia", query: "empresa de tecnologia" },
] as const;

export type NicheKey = (typeof NICHES)[number]["key"];
export const NICHE_KEYS = NICHES.map((n) => n.key) as [NicheKey, ...NicheKey[]];
export const nicheByKey = (key: string) => NICHES.find((n) => n.key === key);
