import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/register.dto';

const storedUser = {
  id: 'u1',
  schoolsById: 'school-user-1',
  name: 'Ivan',
  surname: 'Ivanov',
  fathersName: 'Petrovich',
  class: '10A',
  role: UserRoles.PUPIL,
  schoolName: 'School #1',
};

const expectedUser = { ...storedUser };

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
    user: { create: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: { create: jest.fn() },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    );
  });

  it('creates the user and returns the JWT together with the user', async () => {
    prisma.user.create.mockResolvedValue(storedUser);

    const result = await service.register(dto);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: dto,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', role: UserRoles.PUPIL });
    expect(result).toEqual({ accessToken: 'signed.jwt.token', user: expectedUser });
  });

  it('throws Conflict when schoolsById is already taken', async () => {
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

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: { user: { findFirst: jest.Mock } };
  let jwt: { signAsync: jest.Mock };

  const pupilLogin: LoginDto = { role: UserRoles.PUPIL, schoolsById: 'school-user-1' };
  const adminId = '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90';
  const adminStored = { ...storedUser, id: adminId, role: UserRoles.ADMIN, schoolsById: null, class: null, schoolName: null };

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn() } };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    );
  });

  it('pupil/teacher: finds by schoolsById and the given role', async () => {
    prisma.user.findFirst.mockResolvedValue(storedUser);

    const result = await service.login(pupilLogin);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { schoolsById: 'school-user-1', role: UserRoles.PUPIL },
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', role: UserRoles.PUPIL });
    expect(result).toEqual({ accessToken: 'signed.jwt.token', user: expectedUser });
  });

  it('pupil/teacher: Unauthorized when no matching user (wrong schoolsById or role)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.login(pupilLogin)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('pupil/teacher: BadRequest without schoolsById, no DB query', async () => {
    await expect(
      service.login({ role: UserRoles.TEACHER }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('admin: finds by id and ADMIN role, ignores schoolsById', async () => {
    prisma.user.findFirst.mockResolvedValue(adminStored);

    const result = await service.login({ role: UserRoles.ADMIN, id: adminId });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: adminId, role: UserRoles.ADMIN },
    });
    expect(result.user.role).toBe(UserRoles.ADMIN);
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('admin: BadRequest without id and never queries with an undefined id', async () => {
    await expect(
      service.login({ role: UserRoles.ADMIN }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('admin: Unauthorized when the id belongs to a non-admin', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ role: UserRoles.ADMIN, id: adminId }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not expose fields outside the explicit user response', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...storedUser, secretColumn: 'x' });

    const result = await service.login(pupilLogin);

    expect(result.user).not.toHaveProperty('secretColumn');
  });
});
