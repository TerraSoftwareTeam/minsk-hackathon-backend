import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadImageDto } from '../dto/upload-image.dto';
import { detectImageMimeType } from '../image-signature';

/**
 * Use as @UploadedFile(ValidateImageFilePipe): requires a file of an allowed
 * image type within the size limit. The type is detected from the file bytes,
 * so a renamed or mislabelled file is rejected; the returned file carries the
 * detected MIME type, not the one the client declared.
 */
@Injectable()
export class ValidateImageFilePipe implements PipeTransform {
  async transform(
    file: Express.Multer.File | undefined,
  ): Promise<Express.Multer.File> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const detected = detectImageMimeType(file.buffer);
    const dto = plainToInstance(UploadImageDto, {
      originalname: file.originalname,
      mimetype: detected ?? 'unknown',
      size: file.size,
    });

    const errors = await validate(dto);
    if (errors.length > 0 || !detected) {
      throw new BadRequestException(
        errors.flatMap((e) => Object.values(e.constraints ?? {})),
      );
    }

    return { ...file, mimetype: detected };
  }
}
