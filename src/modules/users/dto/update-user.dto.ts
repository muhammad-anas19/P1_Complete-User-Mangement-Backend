import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UserStatus } from '../entities/user.entity';

// PartialType from @nestjs/swagger (not @nestjs/mapped-types) — a drop-in
// superset that also carries ApiProperty metadata into the generated
// Swagger schema, not just class-validator rules. Makes every
// CreateUserDto field optional for updates (Phase 0 Q12/rules.md: create
// and update deliberately stay separate DTO classes).
export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;
}
