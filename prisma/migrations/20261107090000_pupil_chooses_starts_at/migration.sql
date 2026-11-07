-- The pupil chooses the date of their event on creation; nobody changes it afterwards
-- (the admin only approves or declines). Pending pupil events had no date yet: they get
-- their former deadline, a month after creation. Their voting now closes 3 days before it.
UPDATE "Event" SET "startsAt" = "createdAt" + INTERVAL '30 days'
WHERE "createdByRole" = 'PUPIL' AND "startsAt" IS NULL
  AND "status" IN ('ON_MODERATION', 'ON_VOTE', 'ON_ADMIN_MODERATION');

-- Pupil events: the date exists in every status, except in old rejected events (they were
-- rejected before pupils chose dates). Teacher events: exactly when FINALIZED (set by the
-- approving admin). Admin events: always.
ALTER TABLE "Event" DROP CONSTRAINT "Event_startsAt_check";
ALTER TABLE "Event" ADD CONSTRAINT "Event_startsAt_check" CHECK (
  CASE "createdByRole"
    WHEN 'ADMIN' THEN "startsAt" IS NOT NULL
    WHEN 'PUPIL' THEN "startsAt" IS NOT NULL OR "status" IN ('DECLINED', 'EXPIRED', 'DECLINED_BY_ADMIN')
    ELSE ("status" = 'FINALIZED') = ("startsAt" IS NOT NULL)
  END
);
