import type { AgentTaskType, Prisma, TeamRun } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { officeEvents } from "../office/events/office-events.js";
import { createTask, cancelTask } from "../tasks/services/task.service.js";
import type { CreateTaskInput, SearchLeadsParams } from "../tasks/task.schemas.js";
import { commercialProfile } from "../agents/workers/writer.worker.js";
import { badRequest } from "../lib/errors.js";

export interface TeamRunInput {
  search: SearchLeadsParams;
  /** Score mínimo do Scout para o Atlas registrar no CRM. */
  minScore: number;
  messageKind: "INITIAL" | "NO_WEBSITE";
  writeMessages: boolean;
  report: boolean;
  description?: string;
  idempotencyKey: string;
}

interface StepDef {
  key: "hunter" | "scout" | "atlas" | "writer" | "metrics";
  taskType: AgentTaskType;
  title: string;
}

/** A sequência da equipe. Cada passo só começa quando o anterior conclui. */
function stepsFor(input: TeamRunInput): StepDef[] {
  const steps: StepDef[] = [
    { key: "hunter", taskType: "SEARCH_LEADS", title: "Prospectar no Google Maps" },
    { key: "scout", taskType: "QUALIFY_LEADS", title: "Qualificar as empresas encontradas" },
    { key: "atlas", taskType: "IMPORT_TO_CRM", title: "Registrar no CRM" },
  ];
  if (input.writeMessages) steps.push({ key: "writer", taskType: "GENERATE_MESSAGES", title: "Preparar as mensagens" });
  if (input.report) steps.push({ key: "metrics", taskType: "GENERATE_REPORT", title: "Gerar o relatório" });
  return steps;
}

export function serializeRun(run: TeamRun & { tasks?: { id: string; stepIndex: number | null; status: string; progress: number; agentId: string; errorMessage: string | null; result: unknown }[] }) {
  const input = run.params as unknown as TeamRunInput;
  const steps = stepsFor(input);
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    currentStep: run.currentStep,
    totalSteps: run.totalSteps,
    error: run.error,
    summary: run.summary,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    steps: steps.map((s, i) => {
      const t = run.tasks?.find((x) => x.stepIndex === i);
      return { index: i, key: s.key, title: s.title, taskId: t?.id ?? null, status: t?.status ?? "PENDING", progress: t?.progress ?? 0, error: t?.errorMessage ?? null };
    }),
  };
}

async function publish(runId: string) {
  const run = await prisma.teamRun.findUnique({ where: { id: runId }, include: { tasks: true } });
  if (run) officeEvents.publish(run.organizationId, "team:updated", { run: serializeRun(run) });
}

/** Parâmetros de cada passo, usando o resultado dos anteriores (a busca do Hunter é a origem de tudo). */
function paramsFor(step: StepDef, input: TeamRunInput, searchTaskId: string | null): CreateTaskInput["parameters"] {
  switch (step.taskType) {
    case "SEARCH_LEADS":
      return input.search;
    case "QUALIFY_LEADS":
      return { source: { kind: "search", searchTaskId: searchTaskId! }, targetCities: [input.search.city], limit: 500 };
    case "IMPORT_TO_CRM":
      return { searchTaskId: searchTaskId!, onlyWithoutWebsite: false, minScore: input.minScore };
    case "GENERATE_MESSAGES":
      return { kind: input.messageKind, searchTaskId: searchTaskId!, minScore: 0, limit: 50 };
    case "GENERATE_REPORT":
      return { days: 30 };
    default:
      throw new Error(`Passo sem parâmetros: ${step.taskType}`);
  }
}

async function enqueueStep(run: TeamRun, index: number, userId: string, searchTaskId: string | null) {
  const input = run.params as unknown as TeamRunInput;
  const step = stepsFor(input)[index]!;
  const { task } = await createTask(run.organizationId, userId, {
    taskType: step.taskType,
    parameters: paramsFor(step, input, searchTaskId),
    title: `${step.title} — ${run.title}`,
    priority: 3,
    idempotencyKey: `team:${run.id}:${index}`,
  } as CreateTaskInput);
  await prisma.agentTask.update({ where: { id: task.id }, data: { teamRunId: run.id, stepIndex: index } });
  await prisma.teamRun.update({ where: { id: run.id }, data: { currentStep: index, status: "RUNNING" } });
  await publish(run.id);
}

export async function createTeamRun(organizationId: string, userId: string, input: TeamRunInput) {
  const existing = await prisma.teamRun.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey } }, include: { tasks: true } });
  if (existing) return { run: serializeRun(existing), created: false };
  if (input.writeMessages) {
    const profile = await commercialProfile(organizationId);
    if (!profile.senderName || !profile.serviceOffered) {
      throw badRequest("Para o Writer preparar as mensagens, defina seu nome e o serviço oferecido em Configurações → Prospecção.");
    }
  }
  const steps = stepsFor(input);
  const site = input.search.website === "without" ? " sem site" : "";
  const run = await prisma.teamRun.create({
    data: {
      organizationId,
      createdById: userId,
      title: `${input.search.quantity} empresas${site} em ${input.search.city}/${input.search.state}`,
      params: input as unknown as Prisma.InputJsonValue,
      totalSteps: steps.length,
      idempotencyKey: input.idempotencyKey,
    },
  });
  await enqueueStep(run, 0, userId, null);
  const full = await prisma.teamRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true } });
  return { run: serializeRun(full), created: true };
}

/**
 * Chamado sempre que uma tarefa termina (concluída, falhou, cancelada ou pausada). Se ela pertence a uma
 * missão, decide o próximo passo. É idempotente: rodar duas vezes não cria o passo seguinte em dobro.
 */
export async function syncTeamRun(taskId: string) {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task?.teamRunId || task.stepIndex === null) return;
  const run = await prisma.teamRun.findUnique({ where: { id: task.teamRunId } });
  if (!run || ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return;
  const input = run.params as unknown as TeamRunInput;
  const steps = stepsFor(input);
  const step = steps[task.stepIndex]!;

  if (task.status === "PAUSED") {
    await prisma.teamRun.update({ where: { id: run.id }, data: { status: "PAUSED" } });
    return publish(run.id);
  }
  if (task.status === "QUEUED" || task.status === "RUNNING") {
    await prisma.teamRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    return publish(run.id);
  }
  if (task.status === "FAILED" || task.status === "CANCELLED") {
    await prisma.teamRun.update({
      where: { id: run.id },
      data: { status: task.status, error: task.errorMessage ?? (task.status === "CANCELLED" ? "Missão cancelada" : null), completedAt: new Date() },
    });
    return publish(run.id);
  }
  if (task.status !== "COMPLETED") return;

  const summary = { ...(run.summary as Record<string, unknown>), [step.key]: task.result };
  const searchTask = await prisma.agentTask.findFirst({ where: { teamRunId: run.id, stepIndex: 0 } });
  const saved = (searchTask?.result as { saved?: number } | null)?.saved ?? 0;
  const next = task.stepIndex + 1;

  // Se o Hunter não encontrou nada, não há o que qualificar/registrar: encerra com explicação.
  const nothingFound = step.key === "hunter" && saved === 0;
  if (nothingFound || next >= steps.length) {
    await prisma.teamRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        summary: (nothingFound ? { ...summary, note: "O Google não retornou empresas para estes filtros." } : summary) as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    return publish(run.id);
  }
  await prisma.teamRun.update({ where: { id: run.id }, data: { summary: summary as Prisma.InputJsonValue } });
  // Evita criar o mesmo passo duas vezes se o sync rodar em dobro.
  const already = await prisma.agentTask.findFirst({ where: { teamRunId: run.id, stepIndex: next } });
  if (already) return publish(run.id);
  try {
    await enqueueStep(run, next, run.createdById ?? task.createdById ?? "", searchTask!.id);
  } catch (err) {
    logger.error({ err, runId: run.id }, "falha ao avançar a missão");
    await prisma.teamRun.update({ where: { id: run.id }, data: { status: "FAILED", error: (err as Error).message.slice(0, 1000), completedAt: new Date() } });
    await publish(run.id);
  }
}

export async function listTeamRuns(organizationId: string) {
  const runs = await prisma.teamRun.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20, include: { tasks: true } });
  return runs.map(serializeRun);
}

export async function getTeamRun(organizationId: string, id: string) {
  const run = await prisma.teamRun.findFirst({ where: { id, organizationId }, include: { tasks: true } });
  if (!run) throw notFound("Missão não encontrada");
  return serializeRun(run);
}

/** Cancela a missão: cancela o passo atual e impede os próximos. */
export async function cancelTeamRun(organizationId: string, id: string) {
  const run = await prisma.teamRun.findFirst({ where: { id, organizationId }, include: { tasks: true } });
  if (!run) throw notFound("Missão não encontrada");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) throw conflict("A missão já terminou");
  const current = run.tasks.find((t) => ["QUEUED", "RUNNING", "PAUSED", "PENDING"].includes(t.status));
  await prisma.teamRun.update({ where: { id }, data: { status: "CANCELLED", error: "Cancelada pelo usuário", completedAt: new Date() } });
  if (current) await cancelTask(organizationId, current.id).catch(() => undefined);
  await publish(id);
  return getTeamRun(organizationId, id);
}
