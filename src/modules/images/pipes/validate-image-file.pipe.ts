import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadImageDto } from '../dto/upload-image.dto';

/** Use as @UploadedFile(ValidateImageFilePipe): requires a file, an image MIME type and a size limit. */
@Injectable()
export class ValidateImageFilePipe implements PipeTransform {
  async transform(
    file: Express.Multer.File | undefined,
  ): Promise<Express.Multer.File> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const dto = plainToInstance(UploadImageDto, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    const errors = await validate(dto);

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return file;
  }
}
