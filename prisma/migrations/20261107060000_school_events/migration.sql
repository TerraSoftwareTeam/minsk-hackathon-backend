-- Teachers and admins create (school) events too. The role of the initiator at
-- creation picks the flow; every existing event was created by a pupil.
ALTER TABLE "Event" ADD COLUMN "createdByRole" "UserRoles" NOT NULL DEFAULT 'PUPIL';

-- Admin events expire at their date (startsAt), so it is queried with the status.
CREATE INDEX "Event_status_startsAt_idx" ON "Event"("status", "startsAt");

-- Pupil and teacher events: the date exists exactly when FINALIZED (set by the
-- approving admin). Admin events: the admin sets it on creation, it always exists.
ALTER TABLE "Event" DROP CONSTRAINT "Event_startsAt_only_when_finalized";
ALTER TABLE "Event" ADD CONSTRAINT "Event_startsAt_check" CHECK (
  CASE "createdByRole"
    WHEN 'ADMIN' THEN "startsAt" IS NOT NULL
    ELSE ("status" = 'FINALIZED') = ("startsAt" IS NOT NULL)
  END
);

-- Teacher events skip the teacher moderation; admin events skip every moderation
-- and are open to the whole school.
ALTER TABLE "Event" ADD CONSTRAINT "Event_status_by_creator_check" CHECK (
  CASE "createdByRole"
    WHEN 'TEACHER' THEN "status" NOT IN ('ON_MODERATION', 'DECLINED')
    WHEN 'ADMIN' THEN "status" IN ('ON_VOTE', 'FINALIZED', 'EXPIRED') AND "scope" = 'SCHOOL'
    ELSE TRUE
  END
);
