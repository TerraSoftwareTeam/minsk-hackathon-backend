import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// All fields optional. Who may change which field is enforced in UsersService.
export class UpdateUserDto extends PartialType(CreateUserDto) {}
