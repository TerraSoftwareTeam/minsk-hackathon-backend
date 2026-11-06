import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { toUserResponse } from '../auth/user.mapper';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * Access hierarchy (actor = authenticated user, role read from DB by JwtAuthGuard):
 * - ADMIN:   full control over every user.
 * - TEACHER: self + pupils of their class (teacher.class === pupil.class).
 *            Can create pupils in their class, edit their personal fields, delete them.
 * - PUPIL:   self only.
 *
 * Non-admins may change only personal fields (name, surname).
 * role, class and schoolsById are admin-only: otherwise a pupil could
 * leave the teacher's class, or a teacher could move into another class.
 */

const PERSONAL_FIELDS = ['name', 'surname'] as const;
const ADMIN_ONLY_FIELDS = ['role', 'class', 'schoolsById'] as const;

type SchoolFields = {
  schoolsById: string | null;
  class: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: User, dto: CreateUserDto): Promise<UserResponseDto> {
    const input = actor.role === UserRoles.ADMIN ? dto : this.teacherCreateInput(actor, dto);
    const schoolFields = this.schoolFieldsFor(input.role, {
      schoolsById: input.schoolsById ?? null,
      class: input.class ?? null,
    });

    const user = await this.withPrismaErrors(() =>
      this.prisma.user.create({
        data: {
          name: input.name,
          surname: input.surname,
          role: input.role,
          ...schoolFields,
        },
      }),
    );
    return toUserResponse(user);
  }

  async findAll(actor: User): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: this.manageableScope(actor),
      orderBy: [{ surname: 'asc' }, { name: 'asc' }],
    });
    return users.map(toUserResponse);
  }

  async findOne(actor: User, id: string): Promise<UserResponseDto> {
    const target = await this.findManageableOrThrow(actor, id);
    return toUserResponse(target);
  }

  async update(actor: User, id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const target = await this.findManageableOrThrow(actor, id);
    const data =
      actor.role === UserRoles.ADMIN
        ? this.adminUpdateData(target, dto)
        : this.personalUpdateData(target, dto);

    const updated = await this.withPrismaErrors(() =>
      this.prisma.user.update({ where: { id: target.id }, data }),
    );
    return toUserResponse(updated);
  }

  async remove(actor: User, id: string): Promise<void> {
    const target = await this.findManageableOrThrow(actor, id);
    await this.withPrismaErrors(() => this.prisma.user.delete({ where: { id: target.id } }));
  }

  // ---- access rules ----

  /** Single source of truth for "actor may manage target", used by every endpoint. */
  private canManage(actor: User, target: User): boolean {
    if (actor.role === UserRoles.ADMIN) return true;
    if (actor.id === target.id) return true;
    if (actor.role === UserRoles.TEACHER) return this.isPupilOfTeacher(actor, target);
    return false;
  }

  /** The same rule as canManage, expressed as a Prisma filter for the list endpoint. */
  private manageableScope(actor: User): Prisma.UserWhereInput {
    switch (actor.role) {
      case UserRoles.ADMIN:
        return {};
      case UserRoles.TEACHER:
        if (!actor.class) return { id: actor.id };
        return { OR: [{ id: actor.id }, { role: UserRoles.PUPIL, class: actor.class }] };
      default:
        return { id: actor.id };
    }
  }

  private isPupilOfTeacher(teacher: User, target: User): boolean {
    return (
      target.role === UserRoles.PUPIL &&
      !!teacher.class &&
      target.class === teacher.class
    );
  }

  /** A teacher creates pupils of their own class only. */
  private teacherCreateInput(actor: User, dto: CreateUserDto): CreateUserDto {
    if (actor.role !== UserRoles.TEACHER) {
      throw new ForbiddenException('Only an admin or a teacher can create users');
    }
    if (dto.role !== UserRoles.PUPIL) {
      throw new ForbiddenException('A teacher can only create pupils');
    }
    if (!actor.class) {
      throw new ForbiddenException('Teacher has no class assigned');
    }
    if (dto.class !== undefined && dto.class !== actor.class) {
      throw new ForbiddenException('A teacher can only create pupils of their own class');
    }
    return {
      schoolsById: dto.schoolsById,
      name: dto.name,
      surname: dto.surname,
      role: UserRoles.PUPIL,
      class: actor.class,
    };
  }

  /** Admin may change anything; school fields are re-validated against the resulting role. */
  private adminUpdateData(target: User, dto: UpdateUserDto): Prisma.UserUpdateInput {
    const role = dto.role ?? target.role;
    // When turning a pupil/teacher into an admin the school fields are dropped,
    // so stored values must not count as "provided".
    const keepStored = role !== UserRoles.ADMIN;
    const schoolFields = this.schoolFieldsFor(role, {
      schoolsById: dto.schoolsById ?? (keepStored ? target.schoolsById : null),
      class: dto.class ?? (keepStored ? target.class : null),
    });

    return {
      name: dto.name,
      surname: dto.surname,
      role: dto.role,
      ...schoolFields,
    };
  }

  /** Pupils and teachers may change only personal fields. */
  private personalUpdateData(target: User, dto: UpdateUserDto): Prisma.UserUpdateInput {
    for (const field of ADMIN_ONLY_FIELDS) {
      const value = dto[field];
      // Sending the current value back unchanged is harmless (e.g. a form re-submit).
      if (value !== undefined && value !== target[field]) {
        throw new ForbiddenException(`Only an admin can change "${field}"`);
      }
    }

    const data: Prisma.UserUpdateInput = {};
    for (const field of PERSONAL_FIELDS) {
      if (dto[field] !== undefined) data[field] = dto[field];
    }
    return data;
  }

  /**
   * Validates school fields for a role and returns the values to store.
   * ADMIN: must have none (stored as NULL). PUPIL/TEACHER: all are required.
   */
  private schoolFieldsFor(role: UserRoles, input: SchoolFields): SchoolFields {
    if (role === UserRoles.ADMIN) {
      if (input.schoolsById || input.class) {
        throw new BadRequestException('An admin cannot have schoolsById or class');
      }
      return { schoolsById: null, class: null };
    }

    const missing = (['schoolsById', 'class'] as const).filter((f) => !input[f]);
    if (missing.length > 0) {
      throw new BadRequestException(`${missing.join(', ')} required for ${role}`);
    }
    return input;
  }

  // ---- helpers ----

  /**
   * 404 for a missing user, 403 for an existing one the actor may not manage.
   */
  private async findManageableOrThrow(actor: User, id: string): Promise<User> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (!this.canManage(actor, target)) {
      throw new ForbiddenException('You cannot manage this user');
    }
    return target;
  }

  private async withPrismaErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('User with this schoolsById already exists');
        }
        // Foreign key violation: the user is still referenced (e.g. as an event initiator).
        if (error.code === 'P2003') {
          throw new ConflictException('User is referenced by other records and cannot be deleted');
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('User not found');
        }
      }
      throw error;
    }
  }
}
