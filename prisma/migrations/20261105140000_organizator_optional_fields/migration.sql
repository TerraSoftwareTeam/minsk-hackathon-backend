-- Organizators have no school fields; pupils and teachers must have them.
ALTER TABLE "User" ALTER COLUMN "schoolsById" DROP NOT NULL,
ALTER COLUMN "class" DROP NOT NULL,
ALTER COLUMN "schoolName" DROP NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_role_fields_check" CHECK (
  ("role" = 'ORGANIZATOR' AND "schoolsById" IS NULL AND "class" IS NULL AND "schoolName" IS NULL)
  OR
  ("role" <> 'ORGANIZATOR' AND "schoolsById" IS NOT NULL AND "class" IS NOT NULL AND "schoolName" IS NOT NULL)
);
