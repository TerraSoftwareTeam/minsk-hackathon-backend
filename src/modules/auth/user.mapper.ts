import { User } from '../../../prisma/generated/prisma/client';
import { UserResponseDto } from './dto/user-response.dto';

// Explicit field list: never leak extra columns added to the model later.
export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    schoolsById: user.schoolsById,
    name: user.name,
    surname: user.surname,
    fathersName: user.fathersName,
    class: user.class,
    role: user.role,
    schoolName: user.schoolName,
  };
}
