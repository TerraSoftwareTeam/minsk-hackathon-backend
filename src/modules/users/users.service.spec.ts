import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User, UserRoles } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

const makeUser = (id: string, role: UserRoles, overrides: Partial<User> = {}): User => {
  const isOrg = role === UserRoles.ORGANIZATOR;
  return {
    id,
    schoolsById: isOrg ? null : `sid-${id}`,
    name: `name-${id}`,
    surname: `surname-${id}`,
    fathersName: `father-${id}`,
    class: isOrg ? null : '10A',
    role,
    schoolName: isOrg ? null : 'School #1',
    ...overrides,
  };
};

const organizator = makeUser('org', UserRoles.ORGANIZATOR);
const teacher = makeUser('teacher', UserRoles.TEACHER);
const pupil = makeUser('pupil', UserRoles.PUPIL);
const otherPupil = makeUser('pupil2', UserRoles.PUPIL);
const otherTeacher = makeUser('teacher2', UserRoles.TEACHER);

const pupilDto = {
  schoolsById: 'new-sid',
  name: 'N',
  surname: 'S',
  fathersName: 'F',
  role: UserRoles.PUPIL,
  class: '1A',
  schoolName: 'School #1',
};

describe('UsersService access rules', () => {
  let service: UsersService;
  let prisma: {
    user: Record<'findUnique' | 'findMany' | 'create' | 'update' | 'delete', jest.Mock>;
    school: { findUnique: jest.Mock };
  };
  let store: Map<string, User>;

  beforeEach(() => {
    store = new Map(
      [organizator, teacher, pupil, otherPupil, otherTeacher].map((u) => [u.id, u]),
    );
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }) => store.get(where.id) ?? null),
        findMany: jest.fn(async () => [...store.values()]),
        create: jest.fn(async ({ data }) => makeUser('new', data.role, data)),
        update: jest.fn(async ({ where, data }) => ({ ...store.get(where.id)!, ...data })),
        delete: jest.fn(async () => undefined),
      },
      school: {
        findUnique: jest.fn(async ({ where }) =>
          where.name === 'School #1' ? { id: 's1', name: 'School #1' } : null,
        ),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('ORGANIZATOR', () => {
    it('can create an organizator without school fields (stored as NULL)', async () => {
      const created = await service.create(organizator, {
        name: 'N',
        surname: 'S',
        fathersName: 'F',
        role: UserRoles.ORGANIZATOR,
      });
      expect(created.role).toBe(UserRoles.ORGANIZATOR);
      expect(created.schoolsById).toBeNull();
      expect(created.class).toBeNull();
      expect(created.schoolName).toBeNull();
      expect(prisma.school.findUnique).not.toHaveBeenCalled();
    });

    it('cannot create an organizator with school fields', async () => {
      await expect(
        service.create(organizator, { ...pupilDto, role: UserRoles.ORGANIZATOR }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('cannot create a pupil or teacher without school fields', async () => {
      await expect(
        service.create(organizator, { name: 'N', surname: 'S', fathersName: 'F', role: UserRoles.PUPIL }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(organizator, { ...pupilDto, class: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('can create a pupil with all school fields', async () => {
      const created = await service.create(organizator, pupilDto);
      expect(created.role).toBe(UserRoles.PUPIL);
      expect(created.schoolName).toBe('School #1');
    });

    it('sees every user in the list', async () => {
      const list = await service.findAll(organizator);
      expect(list).toHaveLength(5);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('can read any user', async () => {
      await expect(service.findOne(organizator, pupil.id)).resolves.toMatchObject({ id: pupil.id });
    });

    it('can change a pupil role to TEACHER', async () => {
      await expect(
        service.update(organizator, pupil.id, { role: UserRoles.TEACHER }),
      ).resolves.toMatchObject({ role: UserRoles.TEACHER });
    });

    it('promoting a pupil to ORGANIZATOR clears its school fields', async () => {
      const result = await service.update(organizator, pupil.id, { role: UserRoles.ORGANIZATOR });
      expect(result).toMatchObject({
        role: UserRoles.ORGANIZATOR,
        schoolsById: null,
        class: null,
        schoolName: null,
      });
    });

    it('cannot give school fields to an organizator', async () => {
      await expect(
        service.update(organizator, organizator.id, { class: '9Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('can delete any user', async () => {
      await expect(service.remove(organizator, otherTeacher.id)).resolves.toBeUndefined();
    });
  });

  describe('TEACHER', () => {
    it('can read pupils and self', async () => {
      await expect(service.findOne(teacher, pupil.id)).resolves.toMatchObject({ id: pupil.id });
      await expect(service.findOne(teacher, teacher.id)).resolves.toMatchObject({ id: teacher.id });
    });

    it('cannot read other teachers or organizators', async () => {
      await expect(service.findOne(teacher, otherTeacher.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.findOne(teacher, organizator.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists only pupils and self', async () => {
      await service.findAll(teacher);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ role: UserRoles.PUPIL }, { id: teacher.id }] },
        }),
      );
    });

    it('can edit personal fields of self', async () => {
      await expect(
        service.update(teacher, teacher.id, { name: 'Maria', class: '11B' }),
      ).resolves.toMatchObject({ name: 'Maria', class: '11B' });
    });

    it('cannot change its own role, school or schoolsById', async () => {
      await expect(service.update(teacher, teacher.id, { role: UserRoles.PUPIL })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(teacher, teacher.id, { schoolName: 'Other School' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(teacher, teacher.id, { schoolsById: 'hacked' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot edit a pupil', async () => {
      await expect(service.update(teacher, pupil.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot delete a pupil or self', async () => {
      await expect(service.remove(teacher, pupil.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(teacher, teacher.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('cannot create users', async () => {
      await expect(service.create(teacher, pupilDto)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('PUPIL', () => {
    it('sees only self in the list', async () => {
      await service.findAll(pupil);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: pupil.id } }),
      );
    });

    it('cannot read another user, pupil or teacher', async () => {
      await expect(service.findOne(pupil, otherPupil.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.findOne(pupil, teacher.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('can read self', async () => {
      await expect(service.findOne(pupil, pupil.id)).resolves.toMatchObject({ id: pupil.id });
    });

    it('can update personal fields of self', async () => {
      await expect(service.update(pupil, pupil.id, { name: 'New', class: '11B' })).resolves.toMatchObject({
        name: 'New',
        class: '11B',
      });
    });

    it('cannot change its own role, school or schoolsById', async () => {
      await expect(service.update(pupil, pupil.id, { role: UserRoles.TEACHER })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(pupil, pupil.id, { schoolName: 'Other School' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.update(pupil, pupil.id, { schoolsById: 'hacked' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts protected fields only when they equal current values', async () => {
      await expect(
        service.update(pupil, pupil.id, { role: UserRoles.PUPIL, name: 'Same' }),
      ).resolves.toMatchObject({ name: 'Same' });
    });

    it('cannot update or delete another user', async () => {
      await expect(service.update(pupil, otherPupil.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(pupil, otherPupil.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('can delete self', async () => {
      await expect(service.remove(pupil, pupil.id)).resolves.toBeUndefined();
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: pupil.id } });
    });

    it('cannot create users', async () => {
      await expect(service.create(pupil, pupilDto)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('not found', () => {
    it('throws NotFound for an unknown id', async () => {
      await expect(service.findOne(organizator, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
