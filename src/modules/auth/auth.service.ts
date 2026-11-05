import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toUserResponse } from './user.mapper';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (dto.role === UserRoles.PUPIL) {
      await this.assertClassHasTeacher(dto.class);
    }

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          schoolsById: dto.schoolsById,
          name: dto.name,
          surname: dto.surname,
          fathersName: dto.fathersName,
          role: dto.role,
          class: dto.class,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'User with this schoolsById already exists',
        );
      }
      throw error;
    }

    return this.buildAuthResponse(user);
  }

  /**
   * A pupil may join only an existing class, i.e. one that already has a teacher.
   * Otherwise nobody could manage the pupil, and a typo in the class would
   * silently create a new, orphaned class.
   */
  private async assertClassHasTeacher(className: string): Promise<void> {
    const teacher = await this.prisma.user.findFirst({
      where: { role: UserRoles.TEACHER, class: className },
      select: { id: true },
    });
    if (!teacher) {
      throw new BadRequestException(`Class "${className}" has no teacher yet`);
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.findUserForLogin(dto);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
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
