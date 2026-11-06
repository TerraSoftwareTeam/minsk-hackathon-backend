import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UploadApiResponse } from 'cloudinary';
import { v2 as CloudinarySdk } from 'cloudinary';
import { Image } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOUDINARY } from './cloudinary.provider';
import { IMAGE_UPLOAD_FOLDER } from './images.constants';
import { ImageResponseDto } from './dto/image-response.dto';

@Injectable()
export class ImagesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOUDINARY)
    private readonly cloudinary: typeof CloudinarySdk,
  ) {}

  async uploadImage(
    uploadedById: string,
    file: Express.Multer.File,
  ): Promise<ImageResponseDto> {
    const uploadResult = await this.uploadToCloudinary(file);

    const image = await this.prisma.image.create({
      data: {
        url: uploadResult.secure_url,
        cloudinaryPublicId: uploadResult.public_id,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById,
      },
    });

    return this.toResponse(image);
  }

  async deleteImage(imageId: string): Promise<void> {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      return;
    }

    await this.cloudinary.uploader.destroy(image.cloudinaryPublicId);
    await this.prisma.image.delete({ where: { id: imageId } });
  }

  private uploadToCloudinary(
    file: Express.Multer.File,
  ): Promise<UploadApiResponse> {
    const publicId = randomUUID();

    return new Promise((resolve, reject) => {
      const uploadStream = this.cloudinary.uploader.upload_stream(
        {
          folder: IMAGE_UPLOAD_FOLDER,
          public_id: publicId,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error || !result) {
            reject(
              error ?? new InternalServerErrorException('Image upload failed'),
            );
            return;
          }

          resolve(result);
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  private toResponse(image: Image): ImageResponseDto {
    return {
      id: image.id,
      url: image.url,
      cloudinaryPublicId: image.cloudinaryPublicId,
      originalFileName: image.originalFileName,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      createdAt: image.createdAt,
    };
  }
}
