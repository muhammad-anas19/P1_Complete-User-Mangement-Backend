import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Configuration } from '../../config/configuration';
import { UsersModule } from '../users/users.module';
import { RolesModule } from '../roles/roles.module';
import { UserTokensModule } from '../user-tokens/user-tokens.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordService } from './password.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';
import { CsrfGuard } from '../../common/guards/csrf.guard';

@Module({
  imports: [
    UsersModule, // for the User repository, via UsersModule's exported TypeOrmModule
    RolesModule, // for the Role repository (signup's default-role lookup)
    UserTokensModule, // for OTP/invite/reset token issuing & consumption
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Configuration, true>) => ({
        secret: configService.get('jwt.accessSecret', { infer: true }),
        signOptions: {
          expiresIn: configService.get('jwt.accessExpiresIn', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy, CsrfGuard],
})
export class AuthModule {}
