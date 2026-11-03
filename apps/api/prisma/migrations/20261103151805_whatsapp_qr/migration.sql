-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "maxUnansweredMessages" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "sendAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WhatsAppAuthKey" (
    "connectionId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "keyId" VARCHAR(200) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthKey_pkey" PRIMARY KEY ("connectionId","type","keyId")
);

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_sendAfter_idx" ON "WhatsAppMessage"("status", "sendAfter");

-- AddForeignKey
ALTER TABLE "WhatsAppAuthKey" ADD CONSTRAINT "WhatsAppAuthKey_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
