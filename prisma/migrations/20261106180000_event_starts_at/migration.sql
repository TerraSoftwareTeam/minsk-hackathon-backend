-- Existing events get a start 30 days after creation, so ongoing votes are not
-- expired the moment this migration runs. New events always pass startsAt.
ALTER TABLE "Event" ADD COLUMN "startsAt" TIMESTAMP(3);
UPDATE "Event" SET "startsAt" = "createdAt" + INTERVAL '30 days';
ALTER TABLE "Event" ALTER COLUMN "startsAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Event_status_startsAt_idx" ON "Event"("status", "startsAt");
