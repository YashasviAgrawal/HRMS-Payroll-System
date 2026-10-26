-- CreateEnum
CREATE TYPE "LoginType" AS ENUM ('ADMIN', 'HR_ACCOUNTS', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('APPROVER', 'PAY_BILL_SIGNER', 'USER_SETTINGS_MANAGER', 'HR', 'PAYROLL', 'PENSION', 'CHECKER', 'REPORTING_OFFICER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('PERMANENT_OPS', 'PERMANENT_NPS', 'CONTRACT', 'DAILY_WAGE', 'REEMPLOYED', 'DEPUTATION');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RETIRED', 'RESIGNED', 'TRANSFERRED', 'TERMINATED', 'DECEASED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'CHANGE_MOBILE', 'APPROVE_SIGN');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('SYSTEM', 'DATA');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FileDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PREVIEW', 'APPROVED', 'REJECTED', 'DOWNLOADED', 'VALIDATED', 'INVALID', 'APPLIED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT NOT NULL,
    "payLevel" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "retirementAge" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "type" "EmployeeType" NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "nameHi" TEXT,
    "gender" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "dateOfJoining" DATE NOT NULL,
    "dateOfRetirement" DATE,
    "exitDate" DATE,
    "sectionId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "payLevel" TEXT,
    "payCell" INTEGER,
    "mobile" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "loginType" "LoginType" NOT NULL,
    "loginId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayNameHi" TEXT,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "permissions" "Permission"[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "language" TEXT NOT NULL DEFAULT 'en',
    "employeeId" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "context" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "boardId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "loginType" "LoginType",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL DEFAULT 'DATA',
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" BIGSERIAL NOT NULL,
    "boardId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleHi" TEXT,
    "details" JSONB,
    "payload" JSONB NOT NULL,
    "requiredPermission" "Permission" NOT NULL,
    "sectionId" TEXT,
    "subjectEmployeeId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "makerName" TEXT NOT NULL,
    "makerNote" TEXT,
    "deciderId" TEXT,
    "deciderName" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "boardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("boardId","key")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("boardId","name")
);

-- CreateTable
CREATE TABLE "FileRecord" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "direction" "FileDirection" NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL,
    "meta" JSONB,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Board_code_key" ON "Board"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Section_boardId_code_key" ON "Section"("boardId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Post_boardId_code_key" ON "Post"("boardId", "code");

-- CreateIndex
CREATE INDEX "Employee_boardId_sectionId_idx" ON "Employee"("boardId", "sectionId");

-- CreateIndex
CREATE INDEX "Employee_boardId_status_idx" ON "Employee"("boardId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_boardId_employeeCode_key" ON "Employee"("boardId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_boardId_loginType_loginId_key" ON "User"("boardId", "loginType", "loginId");

-- CreateIndex
CREATE UNIQUE INDEX "User_boardId_loginType_mobile_key" ON "User"("boardId", "loginType", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_loginType_key" ON "User"("employeeId", "loginType");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_purpose_idx" ON "OtpChallenge"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuditLog_boardId_at_idx" ON "AuditLog"("boardId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_boardId_entityType_entityId_idx" ON "AuditLog"("boardId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_boardId_userId_idx" ON "AuditLog"("boardId", "userId");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_id_idx" ON "OutboxEvent"("publishedAt", "id");

-- CreateIndex
CREATE INDEX "ApprovalTask_boardId_status_requiredPermission_idx" ON "ApprovalTask"("boardId", "status", "requiredPermission");

-- CreateIndex
CREATE INDEX "ApprovalTask_boardId_entityType_entityId_idx" ON "ApprovalTask"("boardId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "FileRecord_boardId_kind_period_idx" ON "FileRecord"("boardId", "kind", "period");

-- CreateIndex
CREATE INDEX "MessageLog_boardId_createdAt_idx" ON "MessageLog"("boardId", "createdAt");

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
