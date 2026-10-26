-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "checkedById" TEXT,
ADD COLUMN     "returnAt" TIMESTAMP(3),
ADD COLUMN     "summaryFileId" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "repayFileId" TEXT;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollException" ADD CONSTRAINT "PayrollException_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

