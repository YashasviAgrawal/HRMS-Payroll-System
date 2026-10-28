-- CreateEnum
CREATE TYPE "SeparationKind" AS ENUM ('SUSPENSION', 'RESIGNATION', 'REMOVAL', 'DISMISSAL', 'TERMINATION', 'CONTRACT_END', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "SeparationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NONE', 'CHECKING', 'APPROVED', 'SETTLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ServiceEvent" ADD VALUE 'SUSPENSION';
ALTER TYPE "ServiceEvent" ADD VALUE 'REINSTATEMENT';
ALTER TYPE "ServiceEvent" ADD VALUE 'EXIT';

-- CreateTable
CREATE TABLE "Separation" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "SeparationKind" NOT NULL,
    "status" "SeparationStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveDate" DATE NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" TEXT,
    "endDate" DATE,
    "endNote" TEXT,
    "inputs" JSONB,
    "statement" JSONB,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'NONE',
    "settlementRunId" TEXT,
    "receipts" JSONB,
    "settledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Separation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Separation_boardId_status_idx" ON "Separation"("boardId", "status");

-- CreateIndex
CREATE INDEX "Separation_employeeId_idx" ON "Separation"("employeeId");

-- AddForeignKey
ALTER TABLE "Separation" ADD CONSTRAINT "Separation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

