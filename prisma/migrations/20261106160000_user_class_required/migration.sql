-- Restores the role/fields invariant. The original "User_role_fields_check" was
-- dropped implicitly together with the "schoolName" column it referenced.
-- PUPIL and TEACHER must have schoolsById and a non-blank class; ADMIN has neither.
-- Fails if existing rows violate it: fix those users first.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_fields_check";

ALTER TABLE "User" ADD CONSTRAINT "User_role_fields_check" CHECK (
  ("role" = 'ADMIN' AND "schoolsById" IS NULL AND "class" IS NULL)
  OR
  ("role" <> 'ADMIN' AND "schoolsById" IS NOT NULL AND "class" IS NOT NULL AND btrim("class") <> '')
);
