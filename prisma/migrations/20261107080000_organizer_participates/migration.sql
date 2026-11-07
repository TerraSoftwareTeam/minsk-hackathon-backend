-- The pupil organizer takes part in their event from its creation: one of its voters.
-- Existing pupil events get the organizer's vote, cast when the event was created.
INSERT INTO "EventVote" ("eventId", "voterId", "createdAt")
SELECT e."id", e."initiatorId", e."createdAt"
FROM "Event" e
JOIN "User" u ON u."id" = e."initiatorId"
WHERE e."createdByRole" = 'PUPIL' AND u."role" = 'PUPIL'
ON CONFLICT ("eventId", "voterId") DO NOTHING;

-- An event still on teacher moderation needs one more participant than its organizer.
UPDATE "Event" SET "voteThreshold" = 2
WHERE "createdByRole" = 'PUPIL' AND "status" = 'ON_MODERATION' AND "voteThreshold" < 2;

-- An event on vote that the organizer's vote has just brought to its threshold moves on,
-- as the vote that reaches it would have done.
UPDATE "Event" e SET "status" = 'ON_ADMIN_MODERATION'
WHERE e."createdByRole" = 'PUPIL' AND e."status" = 'ON_VOTE'
  AND (SELECT count(*) FROM "EventVote" v WHERE v."eventId" = e."id") >= e."voteThreshold";
