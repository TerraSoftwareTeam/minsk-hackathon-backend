import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export const CLOUDINARY = Symbol('CLOUDINARY');

export const CloudinaryProvider: FactoryProvider<typeof cloudinary> = {
  provide: CLOUDINARY,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    cloudinary.config({
      cloud_name: configService.getOrThrow<string>('CLOUDINARY_NAME'),
      api_key: configService.getOrThrow<string>('CLOUDINARY_KEY'),
      api_secret: configService.getOrThrow<string>('CLOUDINARY_SECRET'),
    });

    return cloudinary;
  },
};
