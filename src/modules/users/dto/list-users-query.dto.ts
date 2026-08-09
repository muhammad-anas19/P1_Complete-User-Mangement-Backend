import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// Matches frontend/src/entities/user/model/user.types.ts's UserFilterParams
// (`role?: UserRole | 'All'`, `status?: UserStatus | 'All'`) — 'All' means
// "no filter", handled in UsersService, not treated as a real value.
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['Admin', 'Manager', 'Viewer', 'All'] })
  @IsIn(['Admin', 'Manager', 'Viewer', 'All'])
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ enum: ['Active', 'Inactive', 'Pending', 'All'] })
  @IsIn(['Active', 'Inactive', 'Pending', 'All'])
  @IsOptional()
  status?: string;
}
