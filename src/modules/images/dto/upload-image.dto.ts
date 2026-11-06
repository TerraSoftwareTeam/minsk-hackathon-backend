import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '../images.constants';

/** Validates the metadata of an uploaded file (see ValidateImageFilePipe). */
export class UploadImageDto {
  @IsString()
  @IsNotEmpty()
  originalname!: string;

  /** Detected from the file bytes. */
  @IsIn(ALLOWED_IMAGE_MIME_TYPES, {
    message: `Only ${ALLOWED_IMAGE_MIME_TYPES.join(', ')} images are allowed`,
  })
  mimetype!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_SIZE_BYTES, {
    message: `File size must not exceed ${MAX_IMAGE_SIZE_BYTES} bytes`,
  })
  size!: number;
}
