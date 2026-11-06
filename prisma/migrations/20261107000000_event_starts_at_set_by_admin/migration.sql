-- The date is now set by the admin on approval. Only FINALIZED events keep it:
-- their date was agreed on; pending and rejected ones never had one set by an admin.
ALTER TABLE "Event" ALTER COLUMN "startsAt" DROP NOT NULL;
UPDATE "Event" SET "startsAt" = NULL WHERE "status" <> 'FINALIZED';

-- Deadlines are derived from createdAt now.
DROP INDEX "Event_status_startsAt_idx";
CREATE INDEX "Event_status_createdAt_idx" ON "Event"("status", "createdAt");

-- The date exists exactly when the event is FINALIZED.
ALTER TABLE "Event" ADD CONSTRAINT "Event_startsAt_only_when_finalized"
  CHECK (("status" = 'FINALIZED') = ("startsAt" IS NOT NULL));
