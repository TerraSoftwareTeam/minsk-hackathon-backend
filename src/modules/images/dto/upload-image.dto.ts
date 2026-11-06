import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MAX_IMAGE_SIZE_BYTES } from '../images.constants';

const IMAGE_MIME_TYPE_PATTERN =
  /^image\/(jpeg|jpg|png|gif|webp|svg\+xml|bmp|tiff)$/i;

/** Validates the metadata of an uploaded file (see ValidateImageFilePipe). */
export class UploadImageDto {
  @IsString()
  @IsNotEmpty()
  originalname!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(IMAGE_MIME_TYPE_PATTERN, {
    message: 'Only image files are allowed',
  })
  mimetype!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_SIZE_BYTES, {
    message: `File size must not exceed ${MAX_IMAGE_SIZE_BYTES} bytes`,
  })
  size!: number;
}
