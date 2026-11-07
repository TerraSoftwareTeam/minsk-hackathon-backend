import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  Prisma,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { hasRequiredClass } from '../../common/auth/class-invariant';
import { PrismaService } from '../../prisma/prisma.service';
import { toUserResponse } from './user.mapper';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Single entry point for everyone: register or log in by schoolsById.
   * - schoolsById already exists: log that user in (ADMIN included), all other fields are ignored.
   * - schoolsById is new: create the user from name, surname and role, plus class
   *   for PUPIL/TEACHER (an ADMIN has no class).
   *   A pupil may join a class that has no teacher yet. A teacher moderates
   *   the events of every pupil of their class, also ones created before they registered.
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
    return this.buildAuthResponse(user);
  }

  /** Fields needed to create a user; they are optional in the DTO because a login does not need them. */
  private newUserData(dto: RegisterDto) {
    const isAdmin = dto.role === UserRoles.ADMIN;
    const required = isAdmin
      ? (['name', 'surname', 'role'] as const)
      : (['name', 'surname', 'role', 'class'] as const);
    const missing = required.filter((field) => !dto[field]?.trim());
    if (missing.length) {
      throw new BadRequestException(
        `No user with this schoolsById; to register, provide: ${missing.join(', ')}`,
      );
    }
    // Matches the "User_role_fields_check" constraint: an ADMIN has no class.
    if (isAdmin && dto.class !== undefined) {
      throw new BadRequestException('ADMIN cannot have a class');
    }
    const { schoolsById, name, surname, role } = dto as Required<RegisterDto>;
    return { schoolsById, name, surname, role, class: isAdmin ? null : dto.class! };
  }

  private logInExisting(user: User): Promise<AuthResponseDto> {
    if (!hasRequiredClass(user)) {
      throw new ForbiddenException(
        `${user.role} has no class assigned, contact an admin`,
      );
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
   * Every role is found by schoolsById.
   * The role must match the stored one, so a teacher cannot log in as a pupil.
   */
  private findUserForLogin(dto: LoginDto): Promise<User | null> {
    // Guard against findFirst({ where: { schoolsById: undefined } }), which would match any row.
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
