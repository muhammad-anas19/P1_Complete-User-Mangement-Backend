import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UserStatus } from '../entities/user.entity';

// PartialType makes every CreateUserDto field optional for updates (Phase 0
// Q12/rules.md: create and update deliberately stay separate DTO classes,
// never one loose shape reused for both).
export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
