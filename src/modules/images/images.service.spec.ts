import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOUDINARY } from './cloudinary.provider';
import { IMAGE_UPLOAD_FOLDER } from './images.constants';
import { ImagesService } from './images.service';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'image-uuid'),
}));

describe('ImagesService', () => {
  let service: ImagesService;
  const prisma = {
    image: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };
  const cloudinary = {
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  };

  const file = {
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('image-bytes'),
  } as Express.Multer.File;

  const uploadResult = {
    secure_url: 'https://res.cloudinary.com/demo/image/upload/cover.jpg',
    public_id: `${IMAGE_UPLOAD_FOLDER}/image-uuid`,
  };

  const imageRecord = {
    id: 'img-1',
    url: uploadResult.secure_url,
    cloudinaryPublicId: uploadResult.public_id,
    originalFileName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    createdAt: new Date('2026-05-15T12:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CLOUDINARY, useValue: cloudinary },
      ],
    }).compile();

    service = module.get(ImagesService);
    jest.clearAllMocks();

    cloudinary.uploader.upload_stream.mockImplementation(
      (_options, callback) => ({
        end: () => {
          callback(null, uploadResult);
        },
      }),
    );
    cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });
  });

  describe('uploadImage', () => {
    it('uploads to cloudinary and persists image record', async () => {
      prisma.image.create.mockResolvedValue(imageRecord);

      await expect(service.uploadImage('user-1', file)).resolves.toEqual({
        id: 'img-1',
        url: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        originalFileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        createdAt: imageRecord.createdAt,
      });

      expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: IMAGE_UPLOAD_FOLDER,
          public_id: 'image-uuid',
          resource_type: 'image',
        }),
        expect.any(Function),
      );
      expect(prisma.image.create).toHaveBeenCalledWith({
        data: {
          url: uploadResult.secure_url,
          cloudinaryPublicId: uploadResult.public_id,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: 'user-1',
        },
      });
    });

    it('throws when cloudinary returns an error', async () => {
      cloudinary.uploader.upload_stream.mockImplementation(
        (_options, callback) => ({
          end: () => {
            callback(new Error('upload failed'), undefined);
          },
        }),
      );

      await expect(service.uploadImage('user-1', file)).rejects.toThrow(
        'upload failed',
      );
    });

    it('throws when cloudinary returns no result', async () => {
      cloudinary.uploader.upload_stream.mockImplementation(
        (_options, callback) => ({
          end: () => {
            callback(null, undefined);
          },
        }),
      );

      await expect(service.uploadImage('user-1', file)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('deleteImage', () => {
    it('removes image from cloudinary and database', async () => {
      prisma.image.findUnique.mockResolvedValue({
        id: 'img-1',
        cloudinaryPublicId: 'minsk_hackathon_images/old',
      });

      await service.deleteImage('img-1');

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        'minsk_hackathon_images/old',
      );
      expect(prisma.image.delete).toHaveBeenCalledWith({
        where: { id: 'img-1' },
      });
    });

    it('does nothing when image is not found', async () => {
      prisma.image.findUnique.mockResolvedValue(null);

      await service.deleteImage('missing');

      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
      expect(prisma.image.delete).not.toHaveBeenCalled();
    });
  });
});
