import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { UserToken, UserTokenPurpose } from './entities/user-token.entity';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes — short-lived, manually typed
const URL_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — embedded in an emailed link

@Injectable()
export class UserTokensService {
  constructor(
    @InjectRepository(UserToken) private readonly repo: Repository<UserToken>,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * A 6-digit numeric code — cryptographically random (crypto.randomInt,
   * never Math.random()), meant to be manually typed. Low entropy by design
   * (a human has to read and type it), which is exactly why the caller
   * must scope consume() by userId for this purpose — see consume() below.
   */
  async issueOtp(userId: string, purpose: UserTokenPurpose): Promise<string> {
    const raw = randomInt(100000, 1000000).toString();
    await this.repo.save(
      this.repo.create({
        userId,
        tokenHash: this.hash(raw),
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        usedAt: null,
      }),
    );
    return raw;
  }

  /**
   * A 256-bit random hex string, meant to be embedded in an emailed link —
   * high enough entropy that the token value alone safely identifies the
   * user, unlike the 6-digit OTP.
   */
  async issueUrlToken(userId: string, purpose: UserTokenPurpose): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.repo.save(
      this.repo.create({
        userId,
        tokenHash: this.hash(raw),
        purpose,
        expiresAt: new Date(Date.now() + URL_TOKEN_TTL_MS),
        usedAt: null,
      }),
    );
    return raw;
  }

  /**
   * Validates and consumes a token, returning the userId it belongs to.
   * `expectedUserId` should be passed for OTP codes (found via a separate
   * email lookup first) — the 6-digit space is small enough that scoping
   * strictly by userId matters. It's safe to omit for high-entropy URL
   * tokens (invite/reset), where the token itself is the sole credential.
   */
  async consume(
    rawToken: string,
    purpose: UserTokenPurpose,
    expectedUserId?: string,
  ): Promise<string> {
    const tokenHash = this.hash(rawToken);
    const record = await this.repo.findOne({ where: { tokenHash, purpose } });

    if (!record) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (expectedUserId && record.userId !== expectedUserId) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (record.usedAt) {
      throw new UnauthorizedException('This code has already been used');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('This code has expired');
    }

    record.usedAt = new Date();
    await this.repo.save(record);
    return record.userId;
  }

  /**
   * Read-only check — validates a token WITHOUT consuming it, for the
   * accept-invite page's "preview the invited user before they set a
   * password" UI. Returns null (never throws) on any invalid/expired/used
   * token — this is a check the frontend polls to decide what to render,
   * not an action that should produce a 401/403 error page.
   */
  async peek(rawToken: string, purpose: UserTokenPurpose): Promise<string | null> {
    const tokenHash = this.hash(rawToken);
    const record = await this.repo.findOne({ where: { tokenHash, purpose } });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }

    return record.userId;
  }
}
