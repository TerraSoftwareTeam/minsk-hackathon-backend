-- Business invariants that Prisma schema cannot express.
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_team_size_check"
  CHECK ("minTeamSize" >= 1 AND "maxTeamSize" >= "minTeamSize");

-- No draws in playoffs; scores are non-negative.
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_score_check"
  CHECK (
    ("scoreA" IS NULL AND "scoreB" IS NULL)
    OR ("scoreA" >= 0 AND "scoreB" >= 0 AND "scoreA" <> "scoreB")
  );

-- A team cannot play against itself.
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_distinct_teams_check"
  CHECK ("teamAId" IS NULL OR "teamBId" IS NULL OR "teamAId" <> "teamBId");

-- A bracket belongs to exactly the scope of its stage type (school, district or none).
ALTER TABLE "TournamentBracket" ADD CONSTRAINT "TournamentBracket_scope_check"
  CHECK (NOT ("schoolId" IS NOT NULL AND "district" IS NOT NULL));
