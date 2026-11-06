import { ApiProperty } from '@nestjs/swagger';

export class ImageResponseDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v1234567890/minsk_hackathon_images/photo.jpg',
    description: 'Public HTTPS URL of the image',
  })
  url!: string;

  @ApiProperty({
    example: 'minsk_hackathon_images/a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Cloudinary public id (folder/uuid)',
  })
  cloudinaryPublicId!: string;

  @ApiProperty({ example: 'photo.jpg', nullable: true, type: String })
  originalFileName!: string | null;

  @ApiProperty({ example: 'image/jpeg', nullable: true, type: String })
  mimeType!: string | null;

  @ApiProperty({ example: 102400, nullable: true, type: 'integer' })
  sizeBytes!: number | null;

  @ApiProperty({
    example: '2026-11-06T12:00:00.000Z',
    description: 'Upload time (UTC)',
  })
  createdAt!: Date;
}
