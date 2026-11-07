-- An event no longer has one assigned teacher: on ON_MODERATION every teacher
-- of the initiator's class moderates it, on ON_ADMIN_MODERATION every admin.
-- The moderators are derived from the status, nothing is stored. Dropping the
-- column also drops its foreign key and the ("teacherId", "status") index.
ALTER TABLE "Event" DROP COLUMN "teacherId";
