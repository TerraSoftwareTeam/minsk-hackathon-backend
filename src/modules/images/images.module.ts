import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../../prisma/prisma.module';
import { CloudinaryProvider } from './cloudinary.provider';
import { MAX_IMAGE_SIZE_BYTES } from './images.constants';
import { ImagesService } from './images.service';
import { ValidateImageFilePipe } from './pipes/validate-image-file.pipe';

/**
 * Uploads images to Cloudinary and keeps their records in the Image table.
 * Has no routes of its own: a feature module imports it and exposes an upload
 * route with FileInterceptor('file') + ValidateImageFilePipe.
 */
@Module({
  imports: [
    PrismaModule,
    MulterModule.register({
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  ],
  providers: [ImagesService, CloudinaryProvider, ValidateImageFilePipe],
  exports: [ImagesService, ValidateImageFilePipe, MulterModule],
})
export class ImagesModule {}
