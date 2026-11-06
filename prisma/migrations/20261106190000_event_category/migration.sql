-- CreateEnum
CREATE TYPE "EventCategories" AS ENUM ('SPORTS', 'INTELLECTUAL', 'CULTURAL', 'CREATIVE', 'EDUCATIONAL', 'VOLUNTEER', 'ENVIRONMENTAL', 'TOURISM', 'ENTERTAINMENT', 'OTHER');

-- Existing events get OTHER; new events always pass a category.
ALTER TABLE "Event" ADD COLUMN "category" "EventCategories" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Event" ALTER COLUMN "category" DROP DEFAULT;
