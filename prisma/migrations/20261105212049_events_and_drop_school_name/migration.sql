/*
  Warnings:

  - You are about to drop the column `schoolName` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EventStatuses" AS ENUM ('ON_MODERATION', 'DECLINED', 'ON_VOTE', 'EXPIRED', 'ON_ADMIN_MODERATION', 'FINALIZED', 'DECLINED_BY_ADMIN');

-- CreateEnum
CREATE TYPE "Scopes" AS ENUM ('CLASS', 'GRADE', 'SCHOOL');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "schoolName";

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "Scopes" NOT NULL DEFAULT 'CLASS',
    "status" "EventStatuses" NOT NULL DEFAULT 'ON_MODERATION',
    "initiatorId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_name_key" ON "Event"("name");

-- CreateIndex
CREATE INDEX "Event_initiatorId_idx" ON "Event"("initiatorId");

-- CreateIndex
CREATE INDEX "Event_teacherId_idx" ON "Event"("teacherId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
