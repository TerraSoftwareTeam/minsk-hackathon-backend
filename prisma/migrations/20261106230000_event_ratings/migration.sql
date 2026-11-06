-- CreateTable
CREATE TABLE "EventRating" (
    "eventId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRating_pkey" PRIMARY KEY ("eventId","raterId")
);

-- CreateIndex
CREATE INDEX "EventRating_raterId_idx" ON "EventRating"("raterId");

-- AddForeignKey
ALTER TABLE "EventRating" ADD CONSTRAINT "EventRating_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRating" ADD CONSTRAINT "EventRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1 to 5 stars.
ALTER TABLE "EventRating" ADD CONSTRAINT "EventRating_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
