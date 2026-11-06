-- Admins are identified by schoolsById too, so it becomes required for every user.
-- Existing admins get their id as schoolsById: the identifier they logged in with keeps working.
-- ADMIN still has no class; PUPIL and TEACHER must have a non-blank one.
UPDATE "User" SET "schoolsById" = "id" WHERE "schoolsById" IS NULL;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_fields_check";

ALTER TABLE "User" ALTER COLUMN "schoolsById" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_role_fields_check" CHECK (
  ("role" = 'ADMIN' AND "class" IS NULL)
  OR
  ("role" <> 'ADMIN' AND "class" IS NOT NULL AND btrim("class") <> '')
);
