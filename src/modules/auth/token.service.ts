import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import ms from 'ms';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Configuration } from '../../config/configuration';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface IssuedRefreshToken {
  raw: string;
  entity: RefreshToken;
}

// Owns everything about token lifecycle: signing the access-token JWT, and
// issuing/rotating/revoking refresh tokens per the schema and rotation
// design from docs/qa/phase-2-...md Q4 and docs/qa/phase-3-...md Q7/Q8.
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Configuration, true>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
  ) {}

  signAccessToken(user: User): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role.name,
    });
  }

  getAccessTokenMaxAgeMs(): number {
    const value = this.configService.get('jwt.accessExpiresIn', { infer: true });
    return ms(value as ms.StringValue);
  }

  getRefreshTokenMaxAgeMs(): number {
    const value = this.configService.get('jwt.refreshExpiresIn', { infer: true });
    return ms(value as ms.StringValue);
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private generateRawToken(): string {
    return randomBytes(64).toString('hex');
  }

  // No hashing, no DB storage — this value's only job is to be readable by
  // same-origin JS and compared against what comes back in a header. See
  // docs/qa/phase-5-hardening-understanding-check.md B1/B2.
  generateCsrfToken(): string {
    return randomBytes(32).toString('hex');
  }

  async issueRefreshToken(
    userId: string,
    meta: RequestMeta,
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const raw = this.generateRawToken();
    const entity = this.refreshTokenRepo.create({
      userId,
      tokenHash: this.hashToken(raw),
      familyId,
      expiresAt: new Date(Date.now() + this.getRefreshTokenMaxAgeMs()),
      revokedAt: null,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
    await this.refreshTokenRepo.save(entity);
    return { raw, entity };
  }

  /**
   * Validates a presented raw refresh token and, if legitimate and unused,
   * atomically revokes it and mints a replacement in the same family.
   * Throws on any invalid/expired/reused presentation; a reused (already
   * revoked) token additionally revokes the whole family. See
   * docs/qa/phase-3-cookie-auth-understanding-check.md Q7/Q8.
   */
  async rotate(
    rawToken: string,
    meta: RequestMeta,
  ): Promise<IssuedRefreshToken & { userId: string }> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.refreshTokenRepo.findOneBy({ tokenHash });

    if (!existing) {
      throw new UnauthorizedException('Invalid session');
    }

    // Reuse detection takes priority over the plain-expiry check — see Q7.
    if (existing.revokedAt) {
      await this.refreshTokenRepo.update(
        { familyId: existing.familyId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('Session revoked — please sign in again');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired — please sign in again');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.withRepository(this.refreshTokenRepo);
      await repo.update(existing.id, { revokedAt: new Date() });

      const raw = this.generateRawToken();
      const entity = repo.create({
        userId: existing.userId,
        tokenHash: this.hashToken(raw),
        familyId: existing.familyId,
        expiresAt: new Date(Date.now() + this.getRefreshTokenMaxAgeMs()),
        revokedAt: null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      });
      await repo.save(entity);

      return { raw, entity, userId: existing.userId };
    });
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.refreshTokenRepo.update({ tokenHash }, { revokedAt: new Date() });
  }

  // Used after a password reset — a reset proves the old password may have
  // been compromised, so every existing session (every device) should be
  // forced to re-authenticate, not just the one that requested the reset.
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
