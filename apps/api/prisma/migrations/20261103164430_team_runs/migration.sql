-- AlterTable
ALTER TABLE "AgentTask" ADD COLUMN     "stepIndex" INTEGER,
ADD COLUMN     "teamRunId" UUID;

-- CreateTable
CREATE TABLE "TeamRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID,
    "title" VARCHAR(200) NOT NULL,
    "params" JSONB NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'RUNNING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(1000),
    "idempotencyKey" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TeamRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamRun_organizationId_createdAt_idx" ON "TeamRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRun_organizationId_idempotencyKey_key" ON "TeamRun"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_teamRunId_fkey" FOREIGN KEY ("teamRunId") REFERENCES "TeamRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRun" ADD CONSTRAINT "TeamRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
