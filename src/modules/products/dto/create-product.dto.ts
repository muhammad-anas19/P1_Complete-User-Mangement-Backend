import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumberString, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @MinLength(1)
  sku: string;

  @ApiProperty({ example: 'Wireless Mouse' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: 'Electronics' })
  @IsString()
  @MinLength(1)
  category: string;

  // Accepted as a numeric string on the wire too — avoids the client-side
  // float-precision problem before it ever reaches the server. See
  // docs/qa/phase-6-7-...md Q1.
  @ApiProperty({ example: '29.99', description: 'Decimal string, e.g. "29.99" — never a float' })
  @IsNumberString()
  price: string;

  @ApiPropertyOptional({ example: 5, minimum: 0, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  stockQuantity?: number;

  @ApiPropertyOptional({ description: 'Set via POST /products/:id/image instead, normally' })
  @IsString()
  @IsOptional()
  imageUrl?: string;
}
