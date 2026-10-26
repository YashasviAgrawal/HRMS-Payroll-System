-- CreateEnum
CREATE TYPE "NomineeScheme" AS ENUM ('GPF', 'GRATUITY', 'GROUP_INSURANCE', 'FAMILY_PENSION', 'NPS');

-- CreateEnum
CREATE TYPE "ServiceEvent" AS ENUM ('APPOINTMENT', 'CONFIRMATION', 'INCREMENT', 'PROMOTION', 'MACP', 'PAY_FIXATION', 'TRANSFER', 'LEAVE', 'PENALTY', 'REWARD', 'RETIREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "EmployeeStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "aadhaarEnc" TEXT,
ADD COLUMN     "aadhaarHash" TEXT,
ADD COLUMN     "aadhaarLast4" TEXT,
ADD COLUMN     "agencyName" TEXT,
ADD COLUMN     "bankAccountEnc" TEXT,
ADD COLUMN     "bankAccountHash" TEXT,
ADD COLUMN     "bankAccountLast4" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "confirmationDate" DATE,
ADD COLUMN     "contractEnd" DATE,
ADD COLUMN     "contractStart" DATE,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "esicNumber" TEXT,
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "fatherOrSpouseName" TEXT,
ADD COLUMN     "gpfNumber" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "isDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "panEnc" TEXT,
ADD COLUMN     "panHash" TEXT,
ADD COLUMN     "panLast4" TEXT,
ADD COLUMN     "permanentAddress" JSONB,
ADD COLUMN     "pran" TEXT,
ADD COLUMN     "presentAddress" JSONB,
ADD COLUMN     "probationEndDate" DATE,
ADD COLUMN     "uan" TEXT,
ADD COLUMN     "wageBasis" TEXT,
ADD COLUMN     "wageRate" DECIMAL(12,2),
ALTER COLUMN "employeeCode" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "relation" TEXT NOT NULL,
    "gender" TEXT,
    "dateOfBirth" DATE,
    "isDependent" BOOLEAN NOT NULL DEFAULT false,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nominee" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheme" "NomineeScheme" NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nominee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBookEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "event" "ServiceEvent" NOT NULL,
    "eventDate" DATE NOT NULL,
    "orderNumber" TEXT,
    "orderDate" DATE,
    "details" TEXT NOT NULL,
    "detailsHi" TEXT,
    "data" JSONB,
    "documentId" TEXT,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeFieldHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "changedById" TEXT,
    "changedBy" TEXT,
    "approvedById" TEXT,
    "approvedBy" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeFieldHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SanctionedPost" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sanctioned" INTEGER NOT NULL,
    "orderRef" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SanctionedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FamilyMember_employeeId_idx" ON "FamilyMember"("employeeId");

-- CreateIndex
CREATE INDEX "Nominee_employeeId_scheme_idx" ON "Nominee"("employeeId", "scheme");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE INDEX "ServiceBookEntry_employeeId_eventDate_idx" ON "ServiceBookEntry"("employeeId", "eventDate");

-- CreateIndex
CREATE INDEX "EmployeeFieldHistory_employeeId_createdAt_idx" ON "EmployeeFieldHistory"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SanctionedPost_boardId_sectionId_postId_key" ON "SanctionedPost"("boardId", "sectionId", "postId");

-- CreateIndex
CREATE INDEX "Employee_boardId_panHash_idx" ON "Employee"("boardId", "panHash");

-- CreateIndex
CREATE INDEX "Employee_boardId_aadhaarHash_idx" ON "Employee"("boardId", "aadhaarHash");

-- CreateIndex
CREATE INDEX "Employee_boardId_bankAccountHash_idx" ON "Employee"("boardId", "bankAccountHash");

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nominee" ADD CONSTRAINT "Nominee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nominee" ADD CONSTRAINT "Nominee_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBookEntry" ADD CONSTRAINT "ServiceBookEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeFieldHistory" ADD CONSTRAINT "EmployeeFieldHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PRD §1 "Clean payroll": zero duplicate Aadhaar, PAN or bank account among current staff (EM-03).
-- Partial unique indexes enforce it in the database itself; people who have left are excluded, so a
-- re-employed pensioner or a re-used family account after death does not collide with history.
CREATE UNIQUE INDEX "Employee_active_pan_unique" ON "Employee" ("boardId", "panHash")
  WHERE "panHash" IS NOT NULL AND "status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED');
CREATE UNIQUE INDEX "Employee_active_aadhaar_unique" ON "Employee" ("boardId", "aadhaarHash")
  WHERE "aadhaarHash" IS NOT NULL AND "status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED');
CREATE UNIQUE INDEX "Employee_active_bank_unique" ON "Employee" ("boardId", "bankAccountHash")
  WHERE "bankAccountHash" IS NOT NULL AND "status" IN ('DRAFT', 'ACTIVE', 'SUSPENDED');
