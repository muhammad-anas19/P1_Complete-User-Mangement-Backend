import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Shared base for every entity's list-query DTO (Users now; Products/Orders
// later reuse this exact shape — see docs/qa/phase-4-...md Q8). Query
// params always arrive as strings; @Type(() => Number) is what makes the
// global ValidationPipe's `transform: true` actually convert them.
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 10;

  @IsString()
  @IsOptional()
  search?: string;

  // "<field>_<asc|desc>" — validated against an entity-specific allow-list
  // in each service, never interpolated directly into a query.
  @IsString()
  @IsOptional()
  sort?: string;
}
