-- CreateEnum
CREATE TYPE "District" AS ENUM ('CENTRAL', 'FRUNZENSKY', 'LENINSKY', 'MOSKOVSKY', 'OKTYABRSKY', 'PERVOMAYSKY', 'PARTIZANSKY', 'SOVETSKY', 'ZAVODSKOY');

-- CreateEnum
CREATE TYPE "UserRoles" AS ENUM ('PUPIL', 'TEACHER');

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" "District" NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "schoolsById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "fathersName" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "role" "UserRoles" NOT NULL DEFAULT 'PUPIL',
    "schoolName" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "School_name_key" ON "School"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolsById_key" ON "User"("schoolsById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolName_fkey" FOREIGN KEY ("schoolName") REFERENCES "School"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
