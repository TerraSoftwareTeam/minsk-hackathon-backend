import { User, UserRoles } from '../../../prisma/generated/prisma/client';

/**
 * Invariant: every PUPIL and TEACHER has a (non-blank) class; only an ADMIN has none.
 * Also enforced by the "User_role_fields_check" constraint in the database.
 */
export function hasRequiredClass(user: Pick<User, 'role' | 'class'>): boolean {
  return user.role === UserRoles.ADMIN || !!user.class?.trim();
}

/** Trims string input; used by DTOs so "  " cannot pass as a class. */
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
