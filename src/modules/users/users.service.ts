import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { toUserResponse } from './user.mapper';

/**
 * Access rules (actor = the authenticated user, role read from DB):
 * - ORGANIZATOR: everything. Has no schoolsById, class or schoolName.
 * - TEACHER: read pupils and self. Edit self (personal fields only). Cannot delete.
 *            No access to other teachers or organizators.
 * - PUPIL: read/edit/delete only self (personal fields only for edit).
 */

type SchoolFields = {
  schoolsById?: string | null;
  class?: string | null;
  schoolName?: string | null;
};

const PERSONAL_FIELDS = ['name', 'surname', 'fathersName', 'class'] as const;
const PROTECTED_FIELDS = ['role', 'schoolName', 'schoolsById'] as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actor: User, dto: CreateUserDto): Promise<UserResponseDto> {
    this.assertOrganizator(actor);
    const fields = this.schoolFieldsFor(dto.role, dto);
    if (fields.schoolName) {
      await this.findSchoolOrThrow(fields.schoolName);
    }

    const user = await this.withConflictHandling(() =>
      this.prisma.user.create({
        data: {
          name: dto.name,
          surname: dto.surname,
          fathersName: dto.fathersName,
          role: dto.role,
          ...fields,
        },
      }),
    );
    return toUserResponse(user);
  }

  async findAll(actor: User): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: this.readScope(actor),
      orderBy: { surname: 'asc' },
    });
    return users.map(toUserResponse);
  }

  async findOne(actor: User, id: string): Promise<UserResponseDto> {
    const target = await this.findUserOrThrow(id);
    if (!this.canRead(actor, target)) {
      throw new ForbiddenException('You cannot access this user');
    }
    return toUserResponse(target);
  }

  async update(actor: User, id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const target = await this.findUserOrThrow(id);
    const allowed = this.allowedUpdate(actor, target, dto);
    const effectiveRole = allowed.role ?? target.role;

    let data: Prisma.UserUncheckedUpdateInput = { ...allowed };
    if (effectiveRole === UserRoles.ORGANIZATOR) {
      if (allowed.schoolsById !== undefined || allowed.class !== undefined || allowed.schoolName !== undefined) {
        throw new BadRequestException('Organizators cannot have schoolsById, class or schoolName');
      }
      data = { ...data, ...this.schoolFieldsFor(UserRoles.ORGANIZATOR, {}) };
    } else {
      const fields = this.schoolFieldsFor(effectiveRole, {
        schoolsById: allowed.schoolsById ?? target.schoolsById,
        class: allowed.class ?? target.class,
        schoolName: allowed.schoolName ?? target.schoolName,
      });
      if (allowed.schoolName !== undefined && fields.schoolName) {
        await this.findSchoolOrThrow(fields.schoolName);
      }
      data = { ...data, ...fields };
    }

    const updated = await this.withConflictHandling(() =>
      this.prisma.user.update({ where: { id: target.id }, data }),
    );
    return toUserResponse(updated);
  }

  async remove(actor: User, id: string): Promise<void> {
    const target = await this.findUserOrThrow(id);
    if (!this.canDelete(actor, target)) {
      throw new ForbiddenException('You cannot delete this user');
    }
    await this.withConflictHandling(() =>
      this.prisma.user.delete({ where: { id: target.id } }),
    );
  }

  // ---- access rules ----

  private isSelf(actor: User, target: User): boolean {
    return actor.id === target.id;
  }

  private canRead(actor: User, target: User): boolean {
    if (actor.role === UserRoles.ORGANIZATOR) return true;
    if (this.isSelf(actor, target)) return true;
    if (actor.role === UserRoles.TEACHER) return target.role === UserRoles.PUPIL;
    return false;
  }

  private canEdit(actor: User, target: User): boolean {
    if (actor.role === UserRoles.ORGANIZATOR) return true;
    return this.isSelf(actor, target);
  }

  private canDelete(actor: User, target: User): boolean {
    if (actor.role === UserRoles.ORGANIZATOR) return true;
    return actor.role === UserRoles.PUPIL && this.isSelf(actor, target);
  }

  /** Which rows the actor may see in the list endpoint. */
  private readScope(actor: User): Prisma.UserWhereInput {
    switch (actor.role) {
      case UserRoles.ORGANIZATOR:
        return {};
      case UserRoles.TEACHER:
        return { OR: [{ role: UserRoles.PUPIL }, { id: actor.id }] };
      default:
        return { id: actor.id };
    }
  }

  /**
   * Returns the subset of the update the actor is allowed to make.
   * Non-organizators may only change personal fields of themselves.
   */
  private allowedUpdate(actor: User, target: User, dto: UpdateUserDto): UpdateUserDto {
    if (!this.canEdit(actor, target)) {
      throw new ForbiddenException('You cannot modify this user');
    }
    if (actor.role === UserRoles.ORGANIZATOR) {
      return dto;
    }

    for (const field of PROTECTED_FIELDS) {
      const value = dto[field];
      if (value !== undefined && value !== target[field]) {
        throw new ForbiddenException(`You cannot change "${field}"`);
      }
    }
    const personal: UpdateUserDto = {};
    for (const field of PERSONAL_FIELDS) {
      if (dto[field] !== undefined) {
        (personal as Record<string, unknown>)[field] = dto[field];
      }
    }
    return personal;
  }

  /**
   * Validates school fields for a role and returns the values to store.
   * ORGANIZATOR: all school fields must be absent and are stored as NULL.
   * PUPIL/TEACHER: all school fields are required.
   */
  private schoolFieldsFor(role: UserRoles, input: SchoolFields): Required<SchoolFields> {
    if (role === UserRoles.ORGANIZATOR) {
      if (input.schoolsById != null || input.class != null || input.schoolName != null) {
        throw new BadRequestException('Organizators cannot have schoolsById, class or schoolName');
      }
      return { schoolsById: null, class: null, schoolName: null };
    }

    const missing = (['schoolsById', 'class', 'schoolName'] as const).filter((f) => !input[f]);
    if (missing.length > 0) {
      throw new BadRequestException(`${missing.join(', ')} required for ${role}`);
    }
    return {
      schoolsById: input.schoolsById!,
      class: input.class!,
      schoolName: input.schoolName!,
    };
  }

  // ---- helpers ----

  private assertOrganizator(actor: User): void {
    if (actor.role !== UserRoles.ORGANIZATOR) {
      throw new ForbiddenException('Only an organizator can do this');
    }
  }

  private async findUserOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async findSchoolOrThrow(name: string) {
    const school = await this.prisma.school.findUnique({ where: { name } });
    if (!school) {
      throw new BadRequestException(`School "${name}" does not exist`);
    }
    return school;
  }

  private async withConflictHandling<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('User with this schoolsById already exists');
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('User not found');
        }
      }
      throw error;
    }
  }
}
