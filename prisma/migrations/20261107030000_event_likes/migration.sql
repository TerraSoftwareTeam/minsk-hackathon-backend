-- Ratings of 1 to 5 stars are replaced by likes. Every existing rating becomes
-- a like of the same pupil (the stars are dropped), so the counts are kept.

-- CreateTable
CREATE TABLE "EventLike" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLike_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "EventLike_userId_idx" ON "EventLike"("userId");

-- AddForeignKey
ALTER TABLE "EventLike" ADD CONSTRAINT "EventLike_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLike" ADD CONSTRAINT "EventLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EventLike" ("eventId", "userId", "createdAt")
SELECT "eventId", "raterId", "createdAt" FROM "EventRating";

-- DropTable
DROP TABLE "EventRating";
