-- Optional cap on participants (null = unlimited). Voting now stays open past the
-- threshold, until the cap is reached or voting closes 5 days before the event.
ALTER TABLE "Event" ADD COLUMN "maxParticipants" INTEGER;

ALTER TABLE "Event" ADD CONSTRAINT "Event_maxParticipants_check"
  CHECK ("maxParticipants" IS NULL OR "maxParticipants" >= "voteThreshold");
