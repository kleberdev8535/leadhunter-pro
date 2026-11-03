-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('HUNTER', 'SCOUT', 'ATLAS', 'WRITER', 'METRICS');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'AVAILABLE', 'ASSIGNED', 'WORKING', 'WAITING', 'PAUSED', 'COMPLETED', 'ERROR', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AgentTaskType" AS ENUM ('SEARCH_LEADS', 'QUALIFY_LEADS', 'IMPORT_TO_CRM', 'GENERATE_MESSAGES', 'GENERATE_REPORT', 'UPDATE_LEADS');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "currentTaskId" UUID,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "tasksFailed" INTEGER NOT NULL DEFAULT 0,
    "totalRunMs" BIGINT NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "createdById" UUID,
    "taskType" "AgentTaskType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "parameters" JSONB NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "errorMessage" VARCHAR(1000),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" VARCHAR(80),
    "controlRequest" VARCHAR(10),
    "idempotencyKey" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_organizationId_kind_key" ON "Agent"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "AgentTask_status_runAfter_priority_idx" ON "AgentTask"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "AgentTask_organizationId_createdAt_idx" ON "AgentTask"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTask_agentId_status_idx" ON "AgentTask"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_organizationId_idempotencyKey_key" ON "AgentTask"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentTaskLog_taskId_createdAt_idx" ON "AgentTaskLog"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskLog" ADD CONSTRAINT "AgentTaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
