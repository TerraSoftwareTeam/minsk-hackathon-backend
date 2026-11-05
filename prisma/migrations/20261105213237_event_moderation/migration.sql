-- DropIndex
DROP INDEX "Event_teacherId_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "declineReason" TEXT;

-- CreateIndex
CREATE INDEX "Event_teacherId_status_idx" ON "Event"("teacherId", "status");
