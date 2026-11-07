-- Dislikes live in EventLike: value 1 is a like, -1 is a dislike.

-- AlterTable
ALTER TABLE "EventLike" ADD COLUMN "value" INTEGER NOT NULL DEFAULT 1;
