import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'All'],
  })
  @IsIn(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'All'])
  @IsOptional()
  status?: string;
}
