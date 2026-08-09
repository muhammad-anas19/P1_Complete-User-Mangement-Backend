import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Shared base for every entity's list-query DTO (Users now; Products/Orders
// later reuse this exact shape — see docs/qa/phase-4-...md Q8). Query
// params always arrive as strings; @Type(() => Number) is what makes the
// global ValidationPipe's `transform: true` actually convert them.
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 10;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  // "<field>_<asc|desc>" — validated against an entity-specific allow-list
  // in each service, never interpolated directly into a query.
  @ApiPropertyOptional({ example: 'createdAt_desc' })
  @IsString()
  @IsOptional()
  sort?: string;
}
