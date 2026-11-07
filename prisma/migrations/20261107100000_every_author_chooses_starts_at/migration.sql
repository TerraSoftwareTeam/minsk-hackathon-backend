-- Every author (teacher too) chooses the date on creation; nobody changes it afterwards.
-- Pending teacher events had no date yet: they get their former deadline, a month after
-- creation. Every pending stage of any event now ends 3 days before its date.
UPDATE "Event" SET "startsAt" = "createdAt" + INTERVAL '30 days'
WHERE "createdByRole" = 'TEACHER' AND "startsAt" IS NULL
  AND "status" IN ('ON_VOTE', 'ON_ADMIN_MODERATION');

-- The date exists in every status, except in old rejected events (rejected before
-- their authors chose dates). Admin events always had one.
ALTER TABLE "Event" DROP CONSTRAINT "Event_startsAt_check";
ALTER TABLE "Event" ADD CONSTRAINT "Event_startsAt_check" CHECK (
  "startsAt" IS NOT NULL
  OR ("createdByRole" <> 'ADMIN' AND "status" IN ('DECLINED', 'EXPIRED', 'DECLINED_BY_ADMIN'))
);
