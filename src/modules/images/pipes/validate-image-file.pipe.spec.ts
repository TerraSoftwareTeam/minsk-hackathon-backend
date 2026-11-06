import { BadRequestException } from '@nestjs/common';
import { MAX_IMAGE_SIZE_BYTES } from '../images.constants';
import { ValidateImageFilePipe } from './validate-image-file.pipe';

describe('ValidateImageFilePipe', () => {
  const pipe = new ValidateImageFilePipe();

  const validFile = {
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
  } as Express.Multer.File;

  it('returns file when validation passes', async () => {
    await expect(pipe.transform(validFile)).resolves.toBe(validFile);
  });

  it('throws when file is missing', async () => {
    await expect(pipe.transform(undefined)).rejects.toThrow(
      new BadRequestException('File is required'),
    );
  });

  it('throws when mimetype is not an image', async () => {
    await expect(
      pipe.transform({
        ...validFile,
        mimetype: 'text/plain',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when file exceeds max size', async () => {
    await expect(
      pipe.transform({
        ...validFile,
        size: MAX_IMAGE_SIZE_BYTES + 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when original name is missing', async () => {
    await expect(
      pipe.transform({
        ...validFile,
        originalname: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
