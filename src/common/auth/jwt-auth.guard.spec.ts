import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const user = (over: Partial<User>): User => ({
  id: 'u1',
  schoolsById: 's1',
  name: 'N',
  surname: 'S',
  class: '10A',
  role: UserRoles.PUPIL,
  ...over,
});

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let prisma: { user: { findUnique: jest.Mock } };
  let request: { headers: { authorization?: string }; user?: User };

  const context = () =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) };
    guard = new JwtAuthGuard(
      jwt as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
    request = { headers: { authorization: 'Bearer token' } };
  });

  it.each([
    ['pupil with a class', user({})],
    ['teacher with a class', user({ role: UserRoles.TEACHER })],
    [
      'admin without a class',
      user({ role: UserRoles.ADMIN, schoolsById: 'a1', class: null }),
    ],
  ])('lets in a %s', async (_name, stored) => {
    prisma.user.findUnique.mockResolvedValue(stored);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.user).toBe(stored);
  });

  it.each([
    ['pupil', UserRoles.PUPIL, null],
    ['teacher', UserRoles.TEACHER, null],
    ['pupil with a blank class', UserRoles.PUPIL, '   '],
  ])('rejects a %s without a class', async (_name, role, cls) => {
    prisma.user.findUnique.mockResolvedValue(user({ role, class: cls }));
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(request.user).toBeUndefined();
  });

  it('401 without a token', async () => {
    request.headers = {};
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
