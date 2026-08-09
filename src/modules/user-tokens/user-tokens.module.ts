import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserToken } from './entities/user-token.entity';
import { UserTokensService } from './user-tokens.service';

// Standalone module (not owned by AuthModule or UsersModule) so both can
// import it without creating a circular dependency — AuthModule already
// imports UsersModule; UsersModule needs this too (to issue invite tokens
// in UsersService.create()), so this can't live inside either of them.
@Module({
  imports: [TypeOrmModule.forFeature([UserToken])],
  providers: [UserTokensService],
  exports: [UserTokensService],
})
export class UserTokensModule {}
