import { BadRequestException } from '@nestjs/common';
import { MAX_IMAGE_SIZE_BYTES } from '../images.constants';
import { ValidateImageFilePipe } from './validate-image-file.pipe';

const SIGNATURES: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
  'image/gif': Buffer.from('GIF89a\x01\x00', 'latin1'),
  'image/webp': Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
  ]),
};

const file = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: SIGNATURES['image/jpeg'],
    ...over,
  }) as Express.Multer.File;

describe('ValidateImageFilePipe', () => {
  const pipe = new ValidateImageFilePipe();

  it.each(Object.entries(SIGNATURES))(
    'accepts %s by its content',
    async (mime, buffer) => {
      await expect(pipe.transform(file({ buffer }))).resolves.toMatchObject({
        mimetype: mime,
      });
    },
  );

  it('takes the type from the content, not from the client', async () => {
    const result = await pipe.transform(
      file({ mimetype: 'image/jpeg', buffer: SIGNATURES['image/png'] }),
    );
    expect(result.mimetype).toBe('image/png');
  });

  it('throws when file is missing', async () => {
    await expect(pipe.transform(undefined)).rejects.toThrow(
      new BadRequestException('File is required'),
    );
  });

  it('rejects a non-image renamed and labelled as JPEG', async () => {
    await expect(
      pipe.transform(file({ buffer: Buffer.from('#!/bin/sh\necho hi\n') })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects SVG even with an image MIME type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(
      pipe.transform(
        file({ originalname: 'a.svg', mimetype: 'image/svg+xml', buffer: svg }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a file without content', async () => {
    await expect(
      pipe.transform(file({ buffer: Buffer.alloc(0) })),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when file exceeds max size', async () => {
    await expect(
      pipe.transform(file({ size: MAX_IMAGE_SIZE_BYTES + 1 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when original name is missing', async () => {
    await expect(pipe.transform(file({ originalname: '' }))).rejects.toThrow(
      BadRequestException,
    );
  });
});
