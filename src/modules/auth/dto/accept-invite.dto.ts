import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ description: 'Raw invite token from the emailed link' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'MyPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
