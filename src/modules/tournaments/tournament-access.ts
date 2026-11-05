import { ForbiddenException } from '@nestjs/common';
import {
  StageType,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';

/**
 * Permission rules for tournaments. Checked in services, not only controllers.
 *
 * - ORGANIZATOR: everything related to the tournament.
 * - TEACHER: manages any team of their own school (rename, delete, roster, creator
 *   transfer) but cannot create teams. Records results of school-stage games of
 *   their school and of any district/city game.
 * - PUPIL: creates a team (becoming its creator and first member), joins any team
 *   of their school without approval, leaves a team. The creator manages their team.
 */

type TeamScope = { creatorId: string | null; school: { name: string } };

export function isOrganizator(actor: User): boolean {
  return actor.role === UserRoles.ORGANIZATOR;
}

export function assertOrganizator(actor: User): void {
  if (!isOrganizator(actor)) {
    throw new ForbiddenException('Only an organizator can do this');
  }
}

export function isTeacherOfSchool(actor: User, schoolName: string): boolean {
  return actor.role === UserRoles.TEACHER && actor.schoolName === schoolName;
}

export function canManageTeam(actor: User, team: TeamScope): boolean {
  if (isOrganizator(actor)) return true;
  if (isTeacherOfSchool(actor, team.school.name)) return true;
  return actor.role === UserRoles.PUPIL && team.creatorId === actor.id;
}

export function assertCanManageTeam(actor: User, team: TeamScope): void {
  if (!canManageTeam(actor, team)) {
    throw new ForbiddenException('You cannot manage this team');
  }
}

export function canRecordResult(
  actor: User,
  stage: StageType,
  bracketSchoolName: string | null,
): boolean {
  if (isOrganizator(actor)) return true;
  if (actor.role !== UserRoles.TEACHER) return false;
  if (stage === StageType.SCHOOL) {
    return bracketSchoolName !== null && actor.schoolName === bracketSchoolName;
  }
  return true;
}
