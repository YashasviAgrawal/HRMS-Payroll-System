-- CreateEnum
CREATE TYPE "GpfEntryKind" AS ENUM ('OPENING', 'SUBSCRIPTION', 'REFUND', 'ADVANCE', 'WITHDRAWAL', 'INTEREST');

-- CreateEnum
CREATE TYPE "GpfAdvanceKind" AS ENUM ('ADVANCE', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "GpfAdvanceStatus" AS ENUM ('PENDING', 'RUNNING', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED');

-- CreateTable
CREATE TABLE "GpfEntry" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "kind" "GpfEntryKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "runId" TEXT,
    "advanceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpfEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpfAdvance" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "GpfAdvanceKind" NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "instalments" INTEGER NOT NULL DEFAULT 0,
    "instalmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sanctionDate" DATE NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "startMonth" TEXT,
    "status" "GpfAdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "closedMonth" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpfAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "slabs" JSONB NOT NULL,
    "standardDeduction" DECIMAL(12,2) NOT NULL,
    "rebateIncomeLimit" DECIMAL(14,2) NOT NULL,
    "rebateMax" DECIMAL(12,2) NOT NULL,
    "cessPercent" DECIMAL(5,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDeclaration" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'NEW',
    "items" JSONB NOT NULL,
    "proofs" JSONB,
    "status" "DeclarationStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCarryIn" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "salary" DECIMAL(14,2) NOT NULL,
    "tds" DECIMAL(14,2) NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCarryIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsChallan" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "challanNo" TEXT NOT NULL,
    "depositedOn" DATE NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "cess" DECIMAL(14,2) NOT NULL,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form16" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "partBKey" TEXT,
    "partBSha" TEXT,
    "partAKey" TEXT,
    "partASha" TEXT,
    "working" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form16_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueRule" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 0,
    "dates" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DueRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DueReminder" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GpfEntry_employeeId_month_idx" ON "GpfEntry"("employeeId", "month");

-- CreateIndex
CREATE INDEX "GpfEntry_runId_idx" ON "GpfEntry"("runId");

-- CreateIndex
CREATE INDEX "GpfAdvance_employeeId_status_idx" ON "GpfAdvance"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_boardId_fy_regime_key" ON "TaxRule"("boardId", "fy", "regime");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDeclaration_employeeId_fy_key" ON "TaxDeclaration"("employeeId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCarryIn_employeeId_fy_key" ON "TaxCarryIn"("employeeId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "TdsChallan_boardId_month_challanNo_key" ON "TdsChallan"("boardId", "month", "challanNo");

-- CreateIndex
CREATE UNIQUE INDEX "Form16_employeeId_fy_key" ON "Form16"("employeeId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "DueRule_boardId_code_key" ON "DueRule"("boardId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DueReminder_boardId_code_dueOn_key" ON "DueReminder"("boardId", "code", "dueOn");

-- AddForeignKey
ALTER TABLE "GpfEntry" ADD CONSTRAINT "GpfEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpfEntry" ADD CONSTRAINT "GpfEntry_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "GpfAdvance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpfAdvance" ADD CONSTRAINT "GpfAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDeclaration" ADD CONSTRAINT "TaxDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCarryIn" ADD CONSTRAINT "TaxCarryIn_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form16" ADD CONSTRAINT "Form16_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Income tax is worked out by the payroll from the year's projection (ST-04), no longer a standing pay item.
UPDATE "PayHead" SET "calc" = 'SYSTEM' WHERE "code" = 'IT';

-- New heads for Boards already set up: professional tax (switched off in Delhi) and GPF advance recovery.
INSERT INTO "PayHead" ("id", "boardId", "code", "name", "nameHi", "kind", "calc", "value", "postCodes", "prorate", "countsForDa", "taxable", "accountHead", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, b."boardId", 'GPF_REFUND', 'GPF advance recovery', 'जीपीएफ अग्रिम वसूली', 'DEDUCTION', 'SYSTEM', 0, '{}', false, false, true, 'D-2.02 GPF deposits', 15, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "boardId" FROM "PayHead") b
ON CONFLICT ("boardId", "code") DO NOTHING;
INSERT INTO "PayHead" ("id", "boardId", "code", "name", "nameHi", "kind", "calc", "value", "postCodes", "prorate", "countsForDa", "taxable", "accountHead", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, b."boardId", 'PT', 'Professional tax', 'व्यवसाय कर', 'DEDUCTION', 'SYSTEM', 0, '{}', false, false, true, 'D-2.11 Professional tax', 19, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "boardId" FROM "PayHead") b
ON CONFLICT ("boardId", "code") DO NOTHING;

-- GPF rates (ST-01): interest notified by the Ministry of Finance, the ₹5 lakh yearly cap, advance and withdrawal limits.
INSERT INTO "PayRate" ("id", "boardId", "key", "value", "effectiveFrom", "note")
SELECT gen_random_uuid()::text, b."boardId", r.key, r.value, r.since::date, 'Default rate'
FROM (SELECT DISTINCT "boardId" FROM "PayRate") b
CROSS JOIN (VALUES ('GPF_INTEREST', 7.1, '2020-04-01'), ('GPF_ANNUAL_CAP', 500000, '2022-04-01'), ('GPF_ADVANCE_MAX', 75, '2017-04-01'), ('GPF_WITHDRAWAL_MAX', 90, '2017-04-01')) AS r(key, value, since)
ON CONFLICT ("boardId", "key", "effectiveFrom") DO NOTHING;
