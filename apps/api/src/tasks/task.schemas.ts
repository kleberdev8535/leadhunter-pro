import { z } from "zod";
import { NICHE_KEYS } from "../agents/niches.js";

/**
 * Cada tipo de tarefa tem parâmetros estruturados e validados. Nada do que o usuário digita vira
 * código, SQL ou comando: a descrição livre é só anotação e nunca é interpretada.
 */
const text = (max: number) => z.string().trim().min(1).max(max);

export const searchLeadsParams = z.object({
  niches: z.array(z.enum(NICHE_KEYS)).min(1, "Escolha ao menos um nicho").max(5),
  customNiche: z.string().trim().max(60).optional(),
  city: text(120),
  state: text(60),
  neighborhood: z.string().trim().max(120).optional(),
  country: z.string().trim().max(60).default("Brasil"),
  quantity: z.number().int().min(1).max(250),
  website: z.enum(["any", "with", "without"]).default("any"),
  requirePhone: z.boolean().default(false),
  minRating: z.number().min(0).max(5).optional(),
  minReviews: z.number().int().min(0).max(100000).optional(),
  onlyNotInCrm: z.boolean().default(false),
});

export const qualifyLeadsParams = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("search"), searchTaskId: z.string().uuid() }),
    z.object({ kind: z.literal("stage"), stageKey: z.enum(["new", "qualified", "first_contact", "awaiting_reply"]) }),
  ]),
  targetCities: z.array(text(120)).max(10).default([]),
  limit: z.number().int().min(1).max(500).default(200),
});

export const importToCrmParams = z.object({
  searchTaskId: z.string().uuid(),
  onlyWithoutWebsite: z.boolean().default(false),
  moveQualifiedMinScore: z.number().int().min(0).max(100).optional(),
  /** Só registra resultados com score do Scout igual ou acima deste valor. */
  minScore: z.number().int().min(0).max(100).optional(),
});

export const MESSAGE_KINDS = ["INITIAL", "NO_WEBSITE", "FOLLOW_UP", "MEETING", "PROPOSAL", "CLOSING"] as const;

export const generateMessagesParams = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    // Sem nome/serviço, o Writer usa o perfil comercial da organização (Configurações → Prospecção).
    senderName: z.string().trim().max(80).optional(),
    serviceOffered: z.string().trim().max(200).optional(),
    stageKey: z.enum(["new", "qualified", "first_contact", "awaiting_reply", "negotiation", "meeting", "proposal"]).optional(),
    /** Restringe aos leads registrados a partir desta busca (usado na missão da equipe). */
    searchTaskId: z.string().uuid().optional(),
    minScore: z.number().int().min(0).max(100).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .refine((p) => p.stageKey || p.searchTaskId, { message: "Informe a etapa ou a busca de origem", path: ["stageKey"] });

export const generateReportParams = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) });

export const updateLeadsParams = z.object({
  olderThanDays: z.number().int().min(0).max(365).default(30),
  limit: z.number().int().min(1).max(100).default(25),
});

export const createTaskSchema = z.discriminatedUnion("taskType", [
  z.object({ taskType: z.literal("SEARCH_LEADS"), parameters: searchLeadsParams }),
  z.object({ taskType: z.literal("QUALIFY_LEADS"), parameters: qualifyLeadsParams }),
  z.object({ taskType: z.literal("IMPORT_TO_CRM"), parameters: importToCrmParams }),
  z.object({ taskType: z.literal("GENERATE_MESSAGES"), parameters: generateMessagesParams }),
  z.object({ taskType: z.literal("GENERATE_REPORT"), parameters: generateReportParams }),
  z.object({ taskType: z.literal("UPDATE_LEADS"), parameters: updateLeadsParams }),
]).and(
  z.object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    priority: z.number().int().min(1).max(10).default(5),
    // Gerado pelo cliente a cada envio do formulário: reenvio acidental devolve a mesma tarefa.
    idempotencyKey: z.string().trim().min(8).max(100),
  }),
);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type SearchLeadsParams = z.infer<typeof searchLeadsParams>;
export type QualifyLeadsParams = z.infer<typeof qualifyLeadsParams>;
export type ImportToCrmParams = z.infer<typeof importToCrmParams>;
export type GenerateMessagesParams = z.infer<typeof generateMessagesParams>;
export type GenerateReportParams = z.infer<typeof generateReportParams>;
export type UpdateLeadsParams = z.infer<typeof updateLeadsParams>;

export const listTasksQuery = z.object({
  status: z.enum(["PENDING", "QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
  agentId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
