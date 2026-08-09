import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'test.admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'CorrectHorseBatteryStaple123' })
  @IsString()
  @MinLength(1)
  password: string;
}
