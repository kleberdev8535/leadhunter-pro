export interface Stage {
  id: string;
  key: string;
  name: string;
  color: string;
  kind: "OPEN" | "WON" | "LOST";
  position: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type Interest = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";

export interface LeadCard {
  id: string;
  companyName: string;
  contactName: string | null;
  niche: string | null;
  city: string | null;
  phone: string | null;
  phoneE164: string | null;
  website: string | null;
  websiteReported: boolean | null;
  score: number;
  interest: Interest;
  stageId: string;
  position: number;
  lastContactAt: string | null;
  createdAt: string;
  owner: { id: string; name: string } | null;
  tags: Tag[];
  nextTask: { id: string; title: string; dueAt: string } | null;
}

export interface LeadTask {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: "PENDING" | "DONE" | "CANCELED";
  assignee: { id: string; name: string } | null;
}

export interface LeadDetail extends Omit<LeadCard, "nextTask" | "tags"> {
  category: string | null;
  address: string | null;
  neighborhood: string | null;
  state: string | null;
  email: string | null;
  googleMapsUrl: string | null;
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  scoreReasons: { points: number; reason: string }[];
  customFields: Record<string, unknown> | null;
  convertedAt: string | null;
  stage: { id: string; key: string; name: string; color: string };
  source: { type: string; label: string } | null;
  tags: Tag[];
  notes: { id: string; body: string; createdAt: string; author: { id: string; name: string } | null }[];
  activities: { id: string; type: string; description: string; createdAt: string; actor: { id: string; name: string } | null }[];
  tasks: LeadTask[];
}

export interface FilterOptions {
  niches: string[];
  cities: string[];
  members: { id: string; name: string }[];
  tags: Tag[];
}

export const INTEREST_LABEL: Record<Interest, string> = { UNKNOWN: "Sem sinal", LOW: "Baixo", MEDIUM: "Médio", HIGH: "Alto" };

/** Link de conversa no WhatsApp (abre o app/WhatsApp Web; o envio é feito pelo próprio usuário). */
export const whatsappLink = (e164: string | null) => (e164 ? `https://wa.me/${e164.replace(/\D/g, "")}` : null);

export const ACTIVITY_LABEL: Record<string, string> = {
  LEAD_FOUND: "Lead encontrado",
  LEAD_CREATED: "Adicionado ao CRM",
  LEAD_UPDATED: "Dados editados",
  STAGE_CHANGED: "Mudou de etapa",
  QUALIFIED: "Qualificado",
  MESSAGE_PREPARED: "Mensagem preparada",
  MESSAGE_SENT: "Contato realizado",
  REPLY_RECEIVED: "Resposta recebida",
  INTEREST_SHOWN: "Demonstrou interesse",
  MEETING_SCHEDULED: "Reunião agendada",
  PROPOSAL_SENT: "Proposta enviada",
  CONVERTED: "Convertido",
  LOST: "Perdido",
  NOTE_ADDED: "Nota",
  TASK_CREATED: "Tarefa criada",
  TASK_COMPLETED: "Tarefa concluída",
};
