import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNumberString, IsString, MinLength } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  customerName: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  customerEmail: string;

  @ApiProperty({ example: '149.50', description: 'Decimal string, never a float' })
  @IsNumberString()
  totalAmount: string;
}
