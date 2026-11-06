import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  User,
  UserRoles,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

const admin: User = {
  id: 'admin-1',
  schoolsById: 'sch-a1',
  name: 'Anna',
  surname: 'Admin',
  class: null,
  role: UserRoles.ADMIN,
};

const teacher: User = {
  id: 'teacher-1',
  schoolsById: 'sch-t1',
  name: 'Maria',
  surname: 'Sidorova',
  class: '10A',
  role: UserRoles.TEACHER,
};

const pupil: User = {
  id: 'pupil-1',
  schoolsById: 'sch-p1',
  name: 'Ivan',
  surname: 'Ivanov',
  class: '10A',
  role: UserRoles.PUPIL,
};

const pupilOtherClass: User = {
  ...pupil,
  id: 'pupil-2',
  schoolsById: 'sch-p2',
  class: '11B',
};
const otherTeacher: User = {
  ...teacher,
  id: 'teacher-2',
  schoolsById: 'sch-t2',
};
const otherPupil: User = { ...pupil, id: 'pupil-4', schoolsById: 'sch-p4' };

const all = [admin, teacher, otherTeacher, pupil, otherPupil, pupilOtherClass];

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      user: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ id: 'new', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockImplementation(
            ({ where }) => all.find((u) => u.id === where.id) ?? null,
          ),
        update: jest.fn().mockImplementation(({ where, data }) => ({
          ...all.find((u) => u.id === where.id),
          ...data,
        })),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('access hierarchy (findOne / remove)', () => {
    const allowed: [string, User, User][] = [
      ['admin -> anyone', admin, otherTeacher],
      ['admin -> pupil of any class', admin, pupilOtherClass],
      ['teacher -> self', teacher, teacher],
      ['teacher -> pupil of own class', teacher, pupil],
      ['pupil -> self', pupil, pupil],
    ];
    const denied: [string, User, User][] = [
      ['teacher -> pupil of another class', teacher, pupilOtherClass],
      ['teacher -> another teacher of the same class', teacher, otherTeacher],
      ['teacher -> admin', teacher, admin],
      ['pupil -> classmate', pupil, otherPupil],
      ['pupil -> own teacher', pupil, teacher],
      ['pupil -> admin', pupil, admin],
    ];

    it.each(allowed)('allows %s', async (_name, actor, target) => {
      await expect(service.findOne(actor, target.id)).resolves.toMatchObject({
        id: target.id,
      });
      await expect(service.remove(actor, target.id)).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: target.id },
      });
    });

    it.each(denied)('forbids %s', async (_name, actor, target) => {
      await expect(service.findOne(actor, target.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.remove(actor, target.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing user', async () => {
      await expect(service.findOne(admin, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('admin sees everyone', async () => {
      await service.findAll(admin);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('teacher sees self and pupils of own class', async () => {
      await service.findAll(teacher);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ id: teacher.id }, { role: UserRoles.PUPIL, class: '10A' }],
      });
    });

    it('teacher without a class sees only self', async () => {
      await service.findAll({ ...teacher, class: null });
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        id: teacher.id,
      });
    });

    it('pupil sees only self', async () => {
      await service.findAll(pupil);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        id: pupil.id,
      });
    });
  });

  describe('create', () => {
    const newPupil = {
      schoolsById: 'sch-new',
      name: 'Petr',
      surname: 'Petrov',
      role: UserRoles.PUPIL,
    };

    it('teacher creates a pupil in own class', async () => {
      const result = await service.create(teacher, newPupil);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { ...newPupil, class: '10A' },
      });
      expect(result.class).toBe('10A');
    });

    it('teacher cannot create a pupil in another class', async () => {
      await expect(
        service.create(teacher, { ...newPupil, class: '11B' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('teacher cannot create non-pupils', async () => {
      await expect(
        service.create(teacher, { ...newPupil, role: UserRoles.TEACHER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('pupil cannot create users', async () => {
      await expect(service.create(pupil, newPupil)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('admin creates an admin with schoolsById and without a class', async () => {
      await service.create(admin, {
        schoolsById: 'sch-a2',
        name: 'B',
        surname: 'C',
        role: UserRoles.ADMIN,
      });
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
        role: UserRoles.ADMIN,
        schoolsById: 'sch-a2',
        class: null,
      });
    });

    it('admin must give a class to a pupil', async () => {
      await expect(service.create(admin, newPupil)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('admin cannot give a class to an admin', async () => {
      await expect(
        service.create(admin, {
          ...newPupil,
          role: UserRoles.ADMIN,
          class: '10A',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('BadRequest without schoolsById, even for an admin (service is safe on its own)', async () => {
      await expect(
        service.create(admin, {
          name: 'B',
          surname: 'C',
          role: UserRoles.ADMIN,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('maps duplicate schoolsById to Conflict', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.create(teacher, newPupil)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('pupil updates own personal fields', async () => {
      await service.update(pupil, pupil.id, { name: 'Vanya' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: pupil.id },
        data: { name: 'Vanya' },
      });
    });

    it('teacher updates personal fields of a pupil of own class', async () => {
      await service.update(teacher, pupil.id, { surname: 'Ivanov-Petrov' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: pupil.id },
        data: { surname: 'Ivanov-Petrov' },
      });
    });

    it.each([
      ['pupil changes own class', pupil, pupil, { class: '11B' }],
      ['pupil changes own role', pupil, pupil, { role: UserRoles.TEACHER }],
      [
        'teacher moves a pupil to another class',
        teacher,
        pupil,
        { class: '11B' },
      ],
      ['teacher changes own class', teacher, teacher, { class: '11B' }],
      ['teacher promotes a pupil', teacher, pupil, { role: UserRoles.TEACHER }],
      ['teacher changes schoolsById', teacher, pupil, { schoolsById: 'other' }],
    ])('forbids: %s', async (_name, actor, target, dto) => {
      await expect(
        service.update(actor, target.id, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows sending an admin-only field back unchanged', async () => {
      await service.update(pupil, pupil.id, { class: '10A', name: 'Vanya' });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        name: 'Vanya',
      });
    });

    it('teacher cannot update a pupil of another class', async () => {
      await expect(
        service.update(teacher, pupilOtherClass.id, { name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin moves a pupil to another class', async () => {
      const result = await service.update(admin, pupil.id, { class: '11B' });
      expect(result.class).toBe('11B');
    });

    it('admin turning a pupil into an admin keeps schoolsById and clears the class', async () => {
      await service.update(admin, pupil.id, { role: UserRoles.ADMIN });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
        role: UserRoles.ADMIN,
        schoolsById: pupil.schoolsById,
        class: null,
      });
    });

    it('admin turning an admin into a pupil must provide a class', async () => {
      await expect(
        service.update(admin, admin.id, { role: UserRoles.PUPIL }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
