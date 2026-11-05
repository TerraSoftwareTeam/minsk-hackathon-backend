import { BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

const dto: RegisterDto = {
  schoolsById: 'school-user-1',
  name: 'Ivan',
  surname: 'Ivanov',
  fathersName: 'Petrovich',
  role: UserRoles.PUPIL,
  class: '10A',
  schoolName: 'School #1',
};

describe('AuthService.register', () => {
  let service: AuthService;
  let prisma: {
    school: { findUnique: jest.Mock };
    user: { create: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };

  beforeEach(() => {
    prisma = {
      school: { findUnique: jest.fn() },
      user: { create: jest.fn() },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    );
  });

  it('throws BadRequest when the school does not exist', async () => {
    prisma.school.findUnique.mockResolvedValue(null);

    await expect(service.register(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the user and returns only the JWT', async () => {
    prisma.school.findUnique.mockResolvedValue({ id: 's1', name: 'School #1' });
    prisma.user.create.mockResolvedValue({ id: 'u1', role: UserRoles.PUPIL });

    const result = await service.register(dto);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { ...dto, schoolName: 'School #1' },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', role: UserRoles.PUPIL });
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
  });

  it('throws Conflict when schoolsById is already taken', async () => {
    prisma.school.findUnique.mockResolvedValue({ id: 's1', name: 'School #1' });
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
