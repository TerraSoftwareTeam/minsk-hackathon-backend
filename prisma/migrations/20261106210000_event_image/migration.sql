-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "imageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_imageId_key" ON "Event"("imageId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

