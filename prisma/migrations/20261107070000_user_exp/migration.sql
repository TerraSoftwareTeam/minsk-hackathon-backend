-- Pupil's personal progress: experience points, like in Minecraft.
-- Every existing user starts at 0; it never goes negative.
ALTER TABLE "User" ADD COLUMN "exp" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User" ADD CONSTRAINT "User_exp_non_negative_check" CHECK ("exp" >= 0);
