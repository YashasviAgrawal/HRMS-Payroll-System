-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('GAZETTED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'MISSED_PUNCH', 'ON_DUTY', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'DIES_NON');

-- CreateEnum
CREATE TYPE "DaySource" AS ENUM ('DEVICE', 'MUSTER', 'REQUEST', 'LOCK', 'LEAVE');

-- CreateEnum
CREATE TYPE "AttendanceRequestType" AS ENUM ('MISSED_PUNCH', 'ON_DUTY');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "biometricId" TEXT;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "attendanceMode" "AttendanceMode" NOT NULL DEFAULT 'DEVICE',
ADD COLUMN     "weeklyOff" TEXT;

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "kind" "HolidayKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "deviceSerial" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceImport" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "savedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DayStatus" NOT NULL,
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "source" "DaySource" NOT NULL,
    "leaveCode" TEXT,
    "half" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "AttendanceRequestType" NOT NULL,
    "inTime" TEXT,
    "outTime" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "createdById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLock" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedById" TEXT NOT NULL,
    "lockedByName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "unlockNote" TEXT,

    CONSTRAINT "AttendanceLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceMonth" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "daysInMonth" INTEGER NOT NULL,
    "daysOnRoll" INTEGER NOT NULL,
    "present" DECIMAL(5,1) NOT NULL,
    "late" INTEGER NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "onDuty" INTEGER NOT NULL,
    "leave" DECIMAL(5,1) NOT NULL,
    "holidays" INTEGER NOT NULL,
    "weeklyOffs" INTEGER NOT NULL,
    "diesNon" DECIMAL(5,1) NOT NULL,
    "payableDays" DECIMAL(5,1) NOT NULL,
    "workedDays" DECIMAL(5,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Holiday_boardId_date_idx" ON "Holiday"("boardId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_boardId_date_name_key" ON "Holiday"("boardId", "date", "name");

-- CreateIndex
CREATE INDEX "AttendancePunch_boardId_at_idx" ON "AttendancePunch"("boardId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AttendancePunch_employeeId_at_key" ON "AttendancePunch"("employeeId", "at");

-- CreateIndex
CREATE INDEX "AttendanceImport_boardId_createdAt_idx" ON "AttendanceImport"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceDay_boardId_date_idx" ON "AttendanceDay"("boardId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "AttendanceDay"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRequest_boardId_status_idx" ON "AttendanceRequest"("boardId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRequest_employeeId_date_idx" ON "AttendanceRequest"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLock_boardId_sectionId_month_key" ON "AttendanceLock"("boardId", "sectionId", "month");

-- CreateIndex
CREATE INDEX "AttendanceMonth_boardId_month_idx" ON "AttendanceMonth"("boardId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonth_employeeId_month_key" ON "AttendanceMonth"("employeeId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_boardId_biometricId_key" ON "Employee"("boardId", "biometricId");

