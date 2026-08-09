import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw reset token from the emailed link' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'BrandNewPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
