-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('REGULAR', 'SUPPLEMENTARY');

-- CreateEnum
CREATE TYPE "PayChangeReason" AS ENUM ('INITIAL', 'INCREMENT', 'PROMOTION', 'MACP', 'CORRECTION');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('HBA', 'VEHICLE', 'COMPUTER', 'FESTIVAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'RUNNING', 'CLOSED', 'REJECTED');

-- DropIndex
DROP INDEX "PayrollRun_boardId_payGroup_month_key";

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "incrementMonth" INTEGER;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "kind" "RunKind" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "payslipsSentAt" TIMESTAMP(3),
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" JSONB,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "detail" JSONB,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayHistory" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "payLevel" TEXT NOT NULL,
    "payCell" INTEGER NOT NULL,
    "postId" TEXT,
    "reason" "PayChangeReason" NOT NULL,
    "details" JSONB,
    "serviceEntryId" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LoanType" NOT NULL,
    "purpose" TEXT,
    "principal" DECIMAL(12,2) NOT NULL,
    "interestRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "instalments" INTEGER NOT NULL,
    "instalmentAmount" DECIMAL(12,2) NOT NULL,
    "sanctionDate" DATE NOT NULL,
    "orderNumber" TEXT,
    "startMonth" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "closedMonth" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRecovery" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "interest" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayHistory_employeeId_effectiveFrom_idx" ON "PayHistory"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayHistory_boardId_reason_effectiveFrom_idx" ON "PayHistory"("boardId", "reason", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Loan_employeeId_idx" ON "Loan"("employeeId");

-- CreateIndex
CREATE INDEX "Loan_boardId_status_idx" ON "Loan"("boardId", "status");

-- CreateIndex
CREATE INDEX "LoanRecovery_runId_idx" ON "LoanRecovery"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanRecovery_loanId_runId_key" ON "LoanRecovery"("loanId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_boardId_payGroup_month_kind_seq_key" ON "PayrollRun"("boardId", "payGroup", "month", "kind", "seq");

-- AddForeignKey
ALTER TABLE "PayHistory" ADD CONSTRAINT "PayHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRecovery" ADD CONSTRAINT "LoanRecovery_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- PR-09: loan instalments now come from the loans register, so the loan head is worked out by the system.
UPDATE "PayHead" SET "calc" = 'SYSTEM' WHERE "code" = 'LOAN';
