import {
  BadRequestException,
  ForbiddenException,
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
  class: '10A',
  role: UserRoles.PUPIL,
};

const expectedUser = { ...storedUser };

const dto: RegisterDto = {
  schoolsById: 'school-user-1',
  name: 'Ivan',
  surname: 'Ivanov',
  role: UserRoles.PUPIL,
  class: '10A',
};

describe('AuthService.register', () => {
  let service: AuthService;
  let prisma: {
    user: { create: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
  };
  let jwt: { signAsync: jest.Mock };

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn(),
        // By default the pupil's class has a teacher.
        findFirst: jest.fn().mockResolvedValue({ id: 't1' }),
        // By default schoolsById is new.
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    );
  });

  describe('existing schoolsById: logs in', () => {
    it('returns the stored user and ignores the other fields', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser);

      const result = await service.register({
        ...dto,
        name: 'Other',
        role: UserRoles.TEACHER,
        class: '11B',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { schoolsById: 'school-user-1' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'u1',
        role: UserRoles.PUPIL,
      });
      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        user: expectedUser,
      });
    });

    it('works with schoolsById only', async () => {
      prisma.user.findUnique.mockResolvedValue(storedUser);

      const result = await service.register({ schoolsById: 'school-user-1' });

      expect(result.user).toEqual(expectedUser);
    });

    it('logs an existing ADMIN in by schoolsById, no class required', async () => {
      const storedAdmin = {
        ...storedUser,
        id: 'a1',
        schoolsById: 'admin-1',
        role: UserRoles.ADMIN,
        class: null,
      };
      prisma.user.findUnique.mockResolvedValue(storedAdmin);

      const result = await service.register({ schoolsById: 'admin-1' });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'a1',
        role: UserRoles.ADMIN,
      });
      expect(result.user).toEqual(storedAdmin);
    });

    it('Forbidden when the stored pupil/teacher has no class, no token issued', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...storedUser, class: null });

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('new schoolsById: registers', () => {
    it('creates the user and returns the JWT together with the user', async () => {
      prisma.user.create.mockResolvedValue(storedUser);

      const result = await service.register(dto);

      expect(prisma.user.create).toHaveBeenCalledWith({ data: dto });
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'u1',
        role: UserRoles.PUPIL,
      });
      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        user: expectedUser,
      });
    });

    it('pupil: registers into a class that has no teacher yet', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(storedUser);

      await expect(service.register(dto)).resolves.toEqual({
        accessToken: 'signed.jwt.token',
        user: expectedUser,
      });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('teacher: registers without a teacher check (the first teacher opens the class)', async () => {
      const teacherDto: RegisterDto = {
        schoolsById: 'school-user-2',
        name: 'Maria',
        surname: 'Sidorova',
        role: UserRoles.TEACHER,
        class: '10A',
      };
      prisma.user.create.mockResolvedValue({
        ...storedUser,
        role: UserRoles.TEACHER,
      });

      await service.register(teacherDto);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith({ data: teacherDto });
    });

    it.each(['name', 'surname', 'role', 'class'] as const)(
      'BadRequest without %s, no user created',
      async (field) => {
        const partial: RegisterDto = { ...dto, [field]: undefined };

        await expect(service.register(partial)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.user.create).not.toHaveBeenCalled();
      },
    );

    it.each([UserRoles.PUPIL, UserRoles.TEACHER])(
      '%s: BadRequest with a blank class, no user created',
      async (role) => {
        await expect(
          service.register({ ...dto, role, class: '  ' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.user.create).not.toHaveBeenCalled();
      },
    );

    describe('ADMIN', () => {
      // A plain object (not typed as the DTO class), so spreading it is fine for the linter.
      const adminDto = {
        schoolsById: 'admin-9',
        name: 'Olga',
        surname: 'Kovaleva',
        role: UserRoles.ADMIN,
      } satisfies RegisterDto;

      it('registers an admin without a class', async () => {
        prisma.user.create.mockResolvedValue({ ...adminDto, id: 'a9', class: null });

        const result = await service.register(adminDto);

        expect(prisma.user.create).toHaveBeenCalledWith({
          data: { ...adminDto, class: null },
        });
          expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'a9', role: UserRoles.ADMIN });
        expect(result.user.role).toBe(UserRoles.ADMIN);
      });

      it('BadRequest when an admin is given a class, no user created', async () => {
        await expect(
          service.register({ ...adminDto, class: '10A' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it.each(['name', 'surname'] as const)(
        'BadRequest without %s, no user created',
        async (field) => {
          await expect(
            service.register({ ...adminDto, [field]: undefined }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(prisma.user.create).not.toHaveBeenCalled();
        },
      );
    });

    it('a concurrent request took the schoolsById first: logs in as that user', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(storedUser);
      prisma.user.create.mockRejectedValue(p2002());

      const result = await service.register(dto);

      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        user: expectedUser,
      });
    });

    it('rethrows a unique-constraint error when the user still cannot be found', async () => {
      const error = p2002();
      prisma.user.create.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });
});

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: { user: { findFirst: jest.Mock } };
  let jwt: { signAsync: jest.Mock };

  const pupilLogin: LoginDto = {
    role: UserRoles.PUPIL,
    schoolsById: 'school-user-1',
  };
  const adminStored = {
    ...storedUser,
    id: 'a1',
    role: UserRoles.ADMIN,
    schoolsById: 'admin-1',
    class: null,
  };

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
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'u1',
      role: UserRoles.PUPIL,
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: expectedUser,
    });
  });

  it('pupil/teacher: Unauthorized when no matching user (wrong schoolsById or role)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.login(pupilLogin)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it.each([UserRoles.PUPIL, UserRoles.TEACHER])(
    '%s without a class: Forbidden, no token issued',
    async (role) => {
      prisma.user.findFirst.mockResolvedValue({
        ...storedUser,
        role,
        class: null,
      });

      await expect(
        service.login({ role, schoolsById: 'school-user-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    },
  );

  it.each([UserRoles.PUPIL, UserRoles.TEACHER, UserRoles.ADMIN])(
    '%s: BadRequest without schoolsById, never queries with an undefined schoolsById',
    async (role) => {
      await expect(service.login({ role } as LoginDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    },
  );

  it('admin: finds by schoolsById and ADMIN role', async () => {
    prisma.user.findFirst.mockResolvedValue(adminStored);

    const result = await service.login({
      role: UserRoles.ADMIN,
      schoolsById: 'admin-1',
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { schoolsById: 'admin-1', role: UserRoles.ADMIN },
    });
    expect(result.user.role).toBe(UserRoles.ADMIN);
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('admin: Unauthorized when the schoolsById belongs to a non-admin', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ role: UserRoles.ADMIN, schoolsById: 'school-user-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not expose fields outside the explicit user response', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...storedUser,
      secretColumn: 'x',
    });

    const result = await service.login(pupilLogin);

    expect(result.user).not.toHaveProperty('secretColumn');
  });
});
