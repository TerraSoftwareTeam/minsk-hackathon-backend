-- Existing events get threshold 1; new events always pass it explicitly.
ALTER TABLE "Event" ADD COLUMN "voteThreshold" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Event" ALTER COLUMN "voteThreshold" DROP DEFAULT;

ALTER TABLE "Event" ADD CONSTRAINT "Event_voteThreshold_check" CHECK ("voteThreshold" >= 1);
