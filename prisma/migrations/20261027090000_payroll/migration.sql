-- CreateEnum
CREATE TYPE "PayHeadKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER');

-- CreateEnum
CREATE TYPE "PayHeadCalc" AS ENUM ('SYSTEM', 'FIXED', 'PERCENT_BASIC', 'ITEM');

-- CreateEnum
CREATE TYPE "PayGroup" AS ENUM ('OPS', 'NPS', 'CONTRACT', 'PENSION');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CHECKING', 'APPROVING', 'APPROVED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('INCLUDED', 'WITHHELD');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('CREDITED', 'FAILED', 'REPAID');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('BLOCK', 'WARN');

-- CreateEnum
CREATE TYPE "ExceptionResolution" AS ENUM ('EXPLAINED', 'WITHHELD', 'WAIVED');

-- CreateTable
CREATE TABLE "PayMatrix" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "levels" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRate" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayHead" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "kind" "PayHeadKind" NOT NULL,
    "calc" "PayHeadCalc" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "postCodes" TEXT[],
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "countsForDa" BOOLEAN NOT NULL DEFAULT false,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "accountHead" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayItem" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "headCode" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fromMonth" TEXT NOT NULL,
    "toMonth" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "payGroup" "PayGroup" NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "runById" TEXT NOT NULL,
    "runByName" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "employees" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "checkedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "bankFileId" TEXT,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "reopenNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "payGroup" "PayGroup" NOT NULL,
    "sectionId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "payLevel" TEXT,
    "payCell" INTEGER,
    "status" "PayslipStatus" NOT NULL DEFAULT 'INCLUDED',
    "withheldReason" TEXT,
    "daysInMonth" INTEGER NOT NULL,
    "daysOnRoll" DECIMAL(5,1) NOT NULL,
    "lossDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "halfPayDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "workedDays" DECIMAL(5,1),
    "lines" JSONB NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "employer" DECIMAL(12,2) NOT NULL,
    "bankLast4" TEXT,
    "ifsc" TEXT,
    "lastNet" DECIMAL(12,2),
    "changePct" DECIMAL(8,2),
    "creditStatus" "CreditStatus",
    "creditNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollException" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT,
    "code" TEXT NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL,
    "vars" JSONB,
    "resolution" "ExceptionResolution",
    "note" TEXT,
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayMatrix_boardId_effectiveFrom_key" ON "PayMatrix"("boardId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayRate_boardId_key_idx" ON "PayRate"("boardId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PayRate_boardId_key_effectiveFrom_key" ON "PayRate"("boardId", "key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayHead_boardId_code_key" ON "PayHead"("boardId", "code");

-- CreateIndex
CREATE INDEX "EmployeePayItem_employeeId_idx" ON "EmployeePayItem"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayItem_boardId_headCode_idx" ON "EmployeePayItem"("boardId", "headCode");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_boardId_payGroup_month_key" ON "PayrollRun"("boardId", "payGroup", "month");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_month_idx" ON "Payslip"("employeeId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollException_runId_idx" ON "PayrollException"("runId");

