-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "EventRegistration" DROP CONSTRAINT "EventRegistration_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EventRegistration" DROP CONSTRAINT "EventRegistration_userId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_tournamentId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_bracketId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_teamAId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_teamBId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_winnerTeamId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_nextGameId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentGame" DROP CONSTRAINT "TournamentGame_resultById_fkey";

-- DropForeignKey
ALTER TABLE "TournamentTeam" DROP CONSTRAINT "TournamentTeam_tournamentId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentTeam" DROP CONSTRAINT "TournamentTeam_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentTeam" DROP CONSTRAINT "TournamentTeam_creatorId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_tournamentId_fkey";

-- DropForeignKey
ALTER TABLE "Tournament" DROP CONSTRAINT "Tournament_winnerTeamId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentStage" DROP CONSTRAINT "TournamentStage_tournamentId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentBracket" DROP CONSTRAINT "TournamentBracket_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentBracket" DROP CONSTRAINT "TournamentBracket_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "TournamentBracket" DROP CONSTRAINT "TournamentBracket_winnerTeamId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_schoolName_fkey";

-- DropTable
DROP TABLE "Event";

-- DropTable
DROP TABLE "EventRegistration";

-- DropTable
DROP TABLE "School";

-- DropTable
DROP TABLE "TournamentGame";

-- DropTable
DROP TABLE "TournamentTeam";

-- DropTable
DROP TABLE "TeamMember";

-- DropTable
DROP TABLE "Tournament";

-- DropTable
DROP TABLE "TournamentStage";

-- DropTable
DROP TABLE "TournamentBracket";

-- DropEnum
DROP TYPE "District";

-- DropEnum
DROP TYPE "EventAccess";

-- DropEnum
DROP TYPE "TournamentStatus";

-- DropEnum
DROP TYPE "StageType";

-- DropEnum
DROP TYPE "StageStatus";

-- DropEnum
DROP TYPE "BracketStatus";

-- DropEnum
DROP TYPE "GameStatus";

-- DropEnum
DROP TYPE "GameSlot";

