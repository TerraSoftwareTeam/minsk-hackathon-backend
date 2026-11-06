-- A pupil may now register into a class without a teacher; their events wait
-- with no teacher until one registers into the class. The foreign key is kept
-- as it was (ON DELETE RESTRICT).
ALTER TABLE "Event" ALTER COLUMN "teacherId" DROP NOT NULL;
