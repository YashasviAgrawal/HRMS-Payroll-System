-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "openingInterest" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MigrationFile" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "tableName" TEXT,
    "sourceCount" INTEGER,
    "liveCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB,
    "memoFileId" TEXT,
    "missingMemos" INTEGER NOT NULL DEFAULT 0,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRow" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "fixed" JSONB,
    "fixedById" TEXT,
    "fixedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationMapping" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "fileId" TEXT,
    "fields" JSONB NOT NULL,
    "codes" JSONB,
    "options" JSONB,
    "signedById" TEXT,
    "signedByName" TEXT,
    "signedAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationNote" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationSignoff" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordVerification" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "employeeId" TEXT,
    "pensionerId" TEXT,
    "serviceBookById" TEXT,
    "serviceBookByName" TEXT,
    "serviceBookAt" TIMESTAMP(3),
    "confirmedVia" TEXT,
    "confirmedByName" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "problem" TEXT,
    "lockedById" TEXT,
    "lockedByName" TEXT,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParallelRun" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "people" INTEGER NOT NULL,
    "heads" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParallelRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParallelDiff" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "employeeId" TEXT,
    "name" TEXT,
    "head" TEXT NOT NULL,
    "fox" DECIMAL(12,2) NOT NULL,
    "ours" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "explainedById" TEXT,
    "explainedByName" TEXT,
    "explainedAt" TIMESTAMP(3),

    CONSTRAINT "ParallelDiff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationFile_boardId_tableName_idx" ON "MigrationFile"("boardId", "tableName");

-- CreateIndex
CREATE INDEX "MigrationRow_fileId_deleted_idx" ON "MigrationRow"("fileId", "deleted");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationRow_fileId_rowNo_key" ON "MigrationRow"("fileId", "rowNo");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationMapping_boardId_target_key" ON "MigrationMapping"("boardId", "target");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationNote_boardId_key_key" ON "MigrationNote"("boardId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationSignoff_boardId_check_permission_key" ON "MigrationSignoff"("boardId", "check", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "RecordVerification_employeeId_key" ON "RecordVerification"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordVerification_pensionerId_key" ON "RecordVerification"("pensionerId");

-- CreateIndex
CREATE INDEX "RecordVerification_boardId_idx" ON "RecordVerification"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "ParallelRun_boardId_month_key" ON "ParallelRun"("boardId", "month");

-- CreateIndex
CREATE INDEX "ParallelDiff_runId_idx" ON "ParallelDiff"("runId");

-- AddForeignKey
ALTER TABLE "MigrationRow" ADD CONSTRAINT "MigrationRow_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MigrationFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordVerification" ADD CONSTRAINT "RecordVerification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordVerification" ADD CONSTRAINT "RecordVerification_pensionerId_fkey" FOREIGN KEY ("pensionerId") REFERENCES "Pensioner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParallelDiff" ADD CONSTRAINT "ParallelDiff_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ParallelRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

