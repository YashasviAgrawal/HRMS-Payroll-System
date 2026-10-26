-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ADVERTISED', 'CLOSED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('OPEN', 'PENDING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "ApplicantStatus" AS ENUM ('APPLIED', 'ELIGIBLE', 'SHORTLISTED', 'SELECTED', 'WAITLISTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JoiningStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "payLevel" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "reservation" JSONB NOT NULL,
    "advertNumber" TEXT,
    "advertDate" DATE,
    "lastDate" DATE,
    "status" "VacancyStatus" NOT NULL DEFAULT 'DRAFT',
    "selectionStatus" "SelectionStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "fatherName" TEXT,
    "gender" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "qualification" TEXT,
    "score" DECIMAL(7,2),
    "meritRank" INTEGER,
    "status" "ApplicantStatus" NOT NULL DEFAULT 'APPLIED',
    "remarks" TEXT,
    "appointmentLetterNo" TEXT,
    "appointmentLetterDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Joining" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "applicantId" TEXT,
    "vacancyId" TEXT,
    "employeeId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "status" "JoiningStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Joining_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vacancy_boardId_status_idx" ON "Vacancy"("boardId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Vacancy_boardId_referenceNo_key" ON "Vacancy"("boardId", "referenceNo");

-- CreateIndex
CREATE INDEX "Applicant_vacancyId_status_idx" ON "Applicant"("vacancyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Applicant_vacancyId_applicationNo_key" ON "Applicant"("vacancyId", "applicationNo");

-- CreateIndex
CREATE UNIQUE INDEX "Joining_applicantId_key" ON "Joining"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "Joining_employeeId_key" ON "Joining"("employeeId");

-- CreateIndex
CREATE INDEX "Joining_boardId_status_idx" ON "Joining"("boardId", "status");

-- AddForeignKey
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Joining" ADD CONSTRAINT "Joining_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Joining" ADD CONSTRAINT "Joining_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
