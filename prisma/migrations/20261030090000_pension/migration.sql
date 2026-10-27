-- CreateEnum
CREATE TYPE "PensionType" AS ENUM ('SUPERANNUATION', 'VOLUNTARY', 'INVALID', 'COMPULSORY', 'FAMILY');

-- CreateEnum
CREATE TYPE "PensionerStatus" AS ENUM ('ACTIVE', 'STOPPED');

-- CreateEnum
CREATE TYPE "LifeCertificateSource" AS ENUM ('MANUAL', 'JEEVAN_PRAMAAN');

-- CreateEnum
CREATE TYPE "LifeCertificateStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PensionCaseStatus" AS ENUM ('DRAFT', 'CHECKING', 'APPROVING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "pensionerId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pensionerId" TEXT;

-- CreateTable
CREATE TABLE "Pensioner" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ppoNumber" TEXT NOT NULL,
    "type" "PensionType" NOT NULL,
    "status" "PensionerStatus" NOT NULL DEFAULT 'ACTIVE',
    "relation" TEXT NOT NULL DEFAULT 'SELF',
    "payeeName" TEXT NOT NULL,
    "payeeNameHi" TEXT,
    "payeeDob" DATE NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "basicPension" DECIMAL(12,2) NOT NULL,
    "reducedPension" DECIMAL(12,2),
    "reducedFrom" DATE,
    "commutedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commutationDate" DATE,
    "commutationLumpSum" DECIMAL(14,2),
    "fmaEligible" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "endReason" TEXT,
    "bankAccountEnc" TEXT,
    "bankAccountHash" TEXT,
    "bankAccountLast4" TEXT,
    "ifsc" TEXT,
    "bankName" TEXT,
    "previousId" TEXT,
    "caseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pensioner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifeCertificate" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "pensionerId" TEXT NOT NULL,
    "source" "LifeCertificateSource" NOT NULL,
    "status" "LifeCertificateStatus" NOT NULL DEFAULT 'VERIFIED',
    "certifiedOn" DATE NOT NULL,
    "jpId" TEXT,
    "fileKey" TEXT,
    "fileSha" TEXT,
    "fileName" TEXT,
    "note" TEXT,
    "enteredById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifeCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PensionCase" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "PensionType" NOT NULL,
    "retirementDate" DATE NOT NULL,
    "inputs" JSONB NOT NULL,
    "working" JSONB NOT NULL,
    "status" "PensionCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "ppoNumber" TEXT,
    "ppoKey" TEXT,
    "ppoSha" TEXT,
    "pensionerId" TEXT,
    "benefitsRunId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PensionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoDuesItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "byId" TEXT,
    "byName" TEXT,
    "at" TIMESTAMP(3),

    CONSTRAINT "NoDuesItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleTable" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pensioner_employeeId_idx" ON "Pensioner"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Pensioner_boardId_ppoNumber_key" ON "Pensioner"("boardId", "ppoNumber");

-- CreateIndex
CREATE INDEX "LifeCertificate_pensionerId_certifiedOn_idx" ON "LifeCertificate"("pensionerId", "certifiedOn");

-- CreateIndex
CREATE INDEX "PensionCase_employeeId_idx" ON "PensionCase"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "NoDuesItem_caseId_sectionId_key" ON "NoDuesItem"("caseId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleTable_boardId_code_effectiveFrom_key" ON "RuleTable"("boardId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Payslip_pensionerId_idx" ON "Payslip"("pensionerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_pensionerId_fkey" FOREIGN KEY ("pensionerId") REFERENCES "Pensioner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pensioner" ADD CONSTRAINT "Pensioner_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifeCertificate" ADD CONSTRAINT "LifeCertificate_pensionerId_fkey" FOREIGN KEY ("pensionerId") REFERENCES "Pensioner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PensionCase" ADD CONSTRAINT "PensionCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoDuesItem" ADD CONSTRAINT "NoDuesItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PensionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Pension heads (Module 9) for Boards already set up.
INSERT INTO "PayHead" ("id", "boardId", "code", "name", "nameHi", "kind", "calc", "value", "postCodes", "prorate", "countsForDa", "taxable", "accountHead", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, b."boardId", h.code, h.name, h.name_hi, h.kind::"PayHeadKind", 'SYSTEM', 0, '{}', h.prorate, false, h.taxable, h.account, h.sort, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "boardId" FROM "PayHead") b
CROSS JOIN (VALUES
  ('BASIC_PENSION', 'Basic pension', 'मूल पेंशन', 'EARNING', true, true, 'E-2.01 Pension and family pension', 26),
  ('ADDL_PENSION', 'Additional pension (age 80 and above)', 'अतिरिक्त पेंशन (80 वर्ष और ऊपर)', 'EARNING', true, true, 'E-2.01 Pension and family pension', 27),
  ('DR', 'Dearness relief', 'महँगाई राहत', 'EARNING', true, true, 'E-2.02 Dearness relief', 28),
  ('FMA', 'Fixed medical allowance', 'नियत चिकित्सा भत्ता', 'EARNING', true, true, 'E-2.03 Medical allowance to pensioners', 29),
  ('COMMUTATION', 'Commuted part of pension', 'पेंशन का रूपांतरित भाग', 'DEDUCTION', false, true, 'E-2.01 Pension and family pension', 30),
  ('GRATUITY', 'Gratuity', 'उपदान', 'EARNING', false, false, 'E-2.04 Gratuity', 31),
  ('COMMUTED_VALUE', 'Commuted value of pension', 'पेंशन का रूपांतरित मूल्य', 'EARNING', false, false, 'E-2.05 Commuted value of pension', 32),
  ('LEAVE_ENCASHMENT', 'Leave encashment', 'अवकाश नकदीकरण', 'EARNING', false, false, 'E-1.06 Leave encashment', 33)
) AS h(code, name, name_hi, kind, prorate, taxable, account, sort)
ON CONFLICT ("boardId", "code") DO NOTHING;

-- Pension rates (central rules, to confirm for DCB).
INSERT INTO "PayRate" ("id", "boardId", "key", "value", "effectiveFrom", "note")
SELECT gen_random_uuid()::text, b."boardId", r.key, r.value, r.since::date, 'Default rate'
FROM (SELECT DISTINCT "boardId" FROM "PayRate") b
CROSS JOIN (VALUES ('FMA', 1000, '2017-07-01'), ('PENSION_PERCENT', 50, '2006-01-01'), ('PENSION_FULL_YEARS', 20, '2006-01-01'), ('PENSION_MIN_YEARS', 10, '2006-01-01'),
  ('PENSION_MIN', 9000, '2016-01-01'), ('PENSION_MAX', 125000, '2016-01-01'), ('FAMILY_PENSION_ENHANCED', 50, '2006-01-01'), ('FAMILY_PENSION_NORMAL', 30, '2006-01-01'),
  ('COMMUTATION_MAX', 40, '2006-01-01'), ('GRATUITY_CEILING', 2000000, '2016-01-01'), ('GRATUITY_CEILING', 2500000, '2024-01-01'), ('LEAVE_ENCASH_MAX_DAYS', 300, '2006-01-01'),
  ('ADDL_PENSION_80', 20, '2006-01-01'), ('ADDL_PENSION_85', 30, '2006-01-01'), ('ADDL_PENSION_90', 40, '2006-01-01'), ('ADDL_PENSION_95', 50, '2006-01-01'), ('ADDL_PENSION_100', 100, '2006-01-01')) AS r(key, value, since)
ON CONFLICT ("boardId", "key", "effectiveFrom") DO NOTHING;
