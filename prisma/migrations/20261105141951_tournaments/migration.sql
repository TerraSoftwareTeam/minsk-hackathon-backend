-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('REGISTRATION', 'IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('SCHOOL', 'DISTRICT', 'CITY');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "BracketStatus" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('PENDING', 'READY', 'FINISHED', 'BYE');

-- CreateEnum
CREATE TYPE "GameSlot" AS ENUM ('A', 'B');

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_schoolName_fkey";

-- CreateTable
CREATE TABLE "TournamentGame" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "bracketId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'PENDING',
    "teamAId" TEXT,
    "teamBId" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "winnerTeamId" TEXT,
    "nextGameId" TEXT,
    "nextSlot" "GameSlot",
    "resultById" TEXT,
    "finishedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TournamentGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "creatorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
    "minTeamSize" INTEGER NOT NULL,
    "maxTeamSize" INTEGER NOT NULL,
    "schoolStageStartAt" TIMESTAMPTZ(3) NOT NULL,
    "currentStage" "StageType",
    "winnerTeamId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "type" "StageType" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentBracket" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "schoolId" TEXT,
    "district" "District",
    "status" "BracketStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "participantsCount" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "rounds" INTEGER NOT NULL,
    "winnerTeamId" TEXT,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TournamentBracket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentGame_stageId_status_idx" ON "TournamentGame"("stageId", "status");

-- CreateIndex
CREATE INDEX "TournamentGame_nextGameId_idx" ON "TournamentGame"("nextGameId");

-- CreateIndex
CREATE INDEX "TournamentGame_teamAId_idx" ON "TournamentGame"("teamAId");

-- CreateIndex
CREATE INDEX "TournamentGame_teamBId_idx" ON "TournamentGame"("teamBId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGame_bracketId_round_position_key" ON "TournamentGame"("bracketId", "round", "position");

-- CreateIndex
CREATE INDEX "TournamentTeam_schoolId_idx" ON "TournamentTeam"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_name_key" ON "TournamentTeam"("tournamentId", "name");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_tournamentId_userId_key" ON "TeamMember"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_winnerTeamId_key" ON "Tournament"("winnerTeamId");

-- CreateIndex
CREATE INDEX "Tournament_status_schoolStageStartAt_idx" ON "Tournament"("status", "schoolStageStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_type_key" ON "TournamentStage"("tournamentId", "type");

-- CreateIndex
CREATE INDEX "TournamentBracket_stageId_status_idx" ON "TournamentBracket"("stageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentBracket_stageId_schoolId_key" ON "TournamentBracket"("stageId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentBracket_stageId_district_key" ON "TournamentBracket"("stageId", "district");

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "TournamentBracket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "TournamentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "TournamentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "TournamentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_nextGameId_fkey" FOREIGN KEY ("nextGameId") REFERENCES "TournamentGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGame" ADD CONSTRAINT "TournamentGame_resultById_fkey" FOREIGN KEY ("resultById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentBracket" ADD CONSTRAINT "TournamentBracket_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentBracket" ADD CONSTRAINT "TournamentBracket_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentBracket" ADD CONSTRAINT "TournamentBracket_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolName_fkey" FOREIGN KEY ("schoolName") REFERENCES "School"("name") ON DELETE SET NULL ON UPDATE CASCADE;
