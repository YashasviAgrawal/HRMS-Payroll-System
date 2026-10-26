-- CreateEnum
CREATE TYPE "LeavePay" AS ENUM ('FULL', 'HALF', 'NONE');

-- CreateEnum
CREATE TYPE "LeaveCreditMode" AS ENUM ('HALF_YEARLY', 'YEARLY', 'SPELL', 'SERVICE', 'NONE');

-- CreateEnum
CREATE TYPE "LeaveEntryKind" AS ENUM ('OPENING', 'CREDIT', 'DEBIT', 'LAPSE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AttendanceDay" ADD COLUMN     "applicationId" TEXT;

-- AlterTable
ALTER TABLE "AttendanceMonth" ADD COLUMN     "halfPayLeave" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "noPayLeave" DECIMAL(5,1) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "pay" "LeavePay" NOT NULL,
    "creditMode" "LeaveCreditMode" NOT NULL,
    "creditDays" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "cap" DECIMAL(6,1),
    "lapsesAtYearEnd" BOOLEAN NOT NULL DEFAULT false,
    "debitFrom" TEXT,
    "debitFactor" DECIMAL(3,1) NOT NULL DEFAULT 1,
    "countsOffDays" BOOLEAN NOT NULL DEFAULT true,
    "halfDayAllowed" BOOLEAN NOT NULL DEFAULT false,
    "needsCertificate" BOOLEAN NOT NULL DEFAULT false,
    "restrictedOnly" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "employeeTypes" "EmployeeType"[],
    "officerLimitDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedger" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "LeaveEntryKind" NOT NULL,
    "days" DECIMAL(6,1) NOT NULL,
    "period" TEXT,
    "applicationId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApplication" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveCode" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(6,1) NOT NULL,
    "debitCode" TEXT NOT NULL,
    "debitDays" DECIMAL(6,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "contact" TEXT,
    "attachmentKey" TEXT,
    "attachmentName" TEXT,
    "attachmentSha256" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "sanctionRef" TEXT,
    "createdById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_boardId_code_key" ON "LeaveType"("boardId", "code");

-- CreateIndex
CREATE INDEX "LeaveLedger_employeeId_leaveCode_idx" ON "LeaveLedger"("employeeId", "leaveCode");

-- CreateIndex
CREATE INDEX "LeaveLedger_boardId_date_idx" ON "LeaveLedger"("boardId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveLedger_employeeId_leaveCode_period_key" ON "LeaveLedger"("employeeId", "leaveCode", "period");

-- CreateIndex
CREATE INDEX "LeaveApplication_employeeId_fromDate_idx" ON "LeaveApplication"("employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "LeaveApplication_boardId_status_idx" ON "LeaveApplication"("boardId", "status");

