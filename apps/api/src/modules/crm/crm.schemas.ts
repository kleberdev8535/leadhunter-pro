import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const leadInput = z.object({
  companyName: z.string().trim().min(2, "Informe o nome da empresa").max(200),
  contactName: opt(120),
  niche: opt(80),
  category: opt(120),
  address: opt(300),
  neighborhood: opt(120),
  city: opt(120),
  state: opt(60),
  phone: opt(40),
  email: z.union([z.literal(""), z.string().trim().email("Email inválido").max(254)]).optional().nullable().transform((v) => (v ? v : null)),
  website: z.union([z.literal(""), z.string().trim().url("URL inválida").max(500)]).optional().nullable().transform((v) => (v ? v : null)),
  ownerId: z.string().uuid().nullable().optional(),
  interest: z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]).optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
});

export const createLeadSchema = leadInput.extend({ stageId: z.string().uuid().optional() });
export const updateLeadSchema = leadInput.partial();

export const listLeadsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  niche: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  ownerId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  sort: z.enum(["recent", "oldest", "score", "lastContact"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const moveLeadSchema = z.object({
  stageId: z.string().uuid(),
  /** Índice de destino dentro da coluna (0 = topo). */
  index: z.number().int().min(0).max(10_000),
});

export const noteSchema = z.object({ body: z.string().trim().min(1, "Escreva a nota").max(5000) });

export const logActivitySchema = z.object({
  type: z.enum(["MESSAGE_SENT", "REPLY_RECEIVED", "INTEREST_SHOWN", "MEETING_SCHEDULED", "PROPOSAL_SENT"]),
  description: z.string().trim().max(500).optional(),
});

export const taskSchema = z.object({
  leadId: z.string().uuid().nullable().optional(),
  type: z.enum(["CALL", "FOLLOW_UP", "MEETING", "PROPOSAL", "NEGOTIATION", "OTHER"]).default("FOLLOW_UP"),
  title: z.string().trim().min(2, "Informe o título").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  dueAt: z.coerce.date(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export const updateTaskSchema = z.object({
  status: z.enum(["PENDING", "DONE", "CANCELED"]).optional(),
  dueAt: z.coerce.date().optional(),
  title: z.string().trim().min(2).max(200).optional(),
});

export const listTasksQuery = z.object({
  leadId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "DONE", "CANCELED"]).optional(),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8B5CF6"),
});

export const importResultsSchema = z.object({
  resultIds: z.array(z.string().uuid()).min(1).max(250),
});

export type LeadInput = z.infer<typeof leadInput>;
