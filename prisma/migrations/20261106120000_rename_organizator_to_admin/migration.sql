-- Rename in place so existing organizators become admins (no data loss).
ALTER TYPE "UserRoles" RENAME VALUE 'ORGANIZATOR' TO 'ADMIN';
