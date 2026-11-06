import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRoles } from '../../../prisma/generated/prisma/client';
import { hasRequiredClass } from '../../common/auth/class-invariant';
import { PrismaService } from '../../prisma/prisma.service';
import { assignEventsWithoutTeacher } from '../events/teacher-assignment';
import { toUserResponse } from './user.mapper';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Single entry point for PUPIL/TEACHER: register or log in by schoolsById.
   * - schoolsById already exists: log that user in, all other fields are ignored.
   * - schoolsById is new: create the user from name, surname, role and class.
   *   A pupil may join a class that has no teacher yet. A new teacher takes
   *   the events of their class's pupils that were created without a teacher.
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { schoolsById: dto.schoolsById },
    });
    if (existing) {
      return this.logInExisting(existing);
    }

    const data = this.newUserData(dto);

    let user: User;
    try {
      user = await this.prisma.user.create({ data });
    } catch (error) {
      // A concurrent request created the same schoolsById first: log in as that user.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.user.findUnique({
          where: { schoolsById: dto.schoolsById },
        });
        if (raced) {
          return this.logInExisting(raced);
        }
      }
      throw error;
    }
    if (user.role === UserRoles.TEACHER) {
      await this.takeEventsWithoutTeacher(user.id, data.class);
    }
    return this.buildAuthResponse(user);
  }

  /**
   * Runs after the teacher is committed, so a pupil creating an event at the
   * same time either is seen here or sees the teacher (teacher-assignment.ts).
   * A failure does not fail the registration: the teacher already exists.
   */
  private async takeEventsWithoutTeacher(teacherId: string, className: string): Promise<void> {
    try {
      const count = await assignEventsWithoutTeacher(this.prisma, teacherId, className);
      if (count > 0) {
        this.logger.log(`Teacher ${teacherId} took ${count} event(s) of class "${className}"`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to assign the events of class "${className}" to teacher ${teacherId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /** Fields needed to create a user; they are optional in the DTO because a login does not need them. */
  private newUserData(dto: RegisterDto) {
    const missing = (['name', 'surname', 'role', 'class'] as const).filter(
      (field) => !dto[field]?.trim(),
    );
    if (missing.length) {
      throw new BadRequestException(
        `No user with this schoolsById; to register, provide: ${missing.join(', ')}`,
      );
    }
    const { schoolsById, name, surname, role, class: className } = dto as Required<RegisterDto>;
    // The DTO allows only PUPIL/TEACHER; checked again so the service is safe on its own.
    if (role === UserRoles.ADMIN) {
      throw new BadRequestException('ADMIN cannot register');
    }
    return { schoolsById, name, surname, role, class: className };
  }

  private logInExisting(user: User): Promise<AuthResponseDto> {
    if (!hasRequiredClass(user)) {
      throw new ForbiddenException(`${user.role} has no class assigned, contact an admin`);
    }
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.findUserForLogin(dto);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.logInExisting(user);
  }

  /**
   * ADMIN is found by id; PUPIL/TEACHER by schoolsById.
   * The role must match the stored one, so a teacher cannot log in as a pupil.
   */
  private findUserForLogin(dto: LoginDto): Promise<User | null> {
    if (dto.role === UserRoles.ADMIN) {
      // Guard against findFirst({ where: { id: undefined } }), which would match any row.
      if (!dto.id) {
        throw new BadRequestException('id is required for ADMIN');
      }
      return this.prisma.user.findFirst({
        where: { id: dto.id, role: UserRoles.ADMIN },
      });
    }

    if (!dto.schoolsById) {
      throw new BadRequestException(`schoolsById is required for ${dto.role}`);
    }
    return this.prisma.user.findFirst({
      where: { schoolsById: dto.schoolsById, role: dto.role },
    });
  }

  private async buildAuthResponse(user: User): Promise<AuthResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    return { accessToken, user: toUserResponse(user) };
  }
}
