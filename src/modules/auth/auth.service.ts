import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toUserResponse } from '../users/user.mapper';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const school = await this.prisma.school.findUnique({
      where: { name: dto.schoolName },
    });
    if (!school) {
      throw new BadRequestException(
        `School "${dto.schoolName}" does not exist`,
      );
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
          schoolName: school.name,
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

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { schoolsById: dto.schoolsById },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid schoolsById');
    }

    return this.buildAuthResponse(user);
  }

  private async buildAuthResponse(user: User): Promise<AuthResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    return { accessToken, user: toUserResponse(user) };
  }

}
