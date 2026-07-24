import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

// One row per issued refresh token, never updated in place — a refresh
// mints a NEW row and marks the old one revoked, rather than overwriting the
// old token's value. Overwriting in place would destroy the history needed
// for reuse detection. See docs/qa/phase-2-schema-migrations-understanding-check.md
// Q4 for the full rotation/reuse-detection design this schema supports.
//
// Note: this entity isn't wired into any Nest module yet (that's Phase 3's
// AuthModule) — it's still picked up by TypeOrmModule's entity glob in
// database.module.ts, so it's part of the schema/migrations starting now.
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // SHA-256 of the raw token — never the plaintext value. A fast hash is
  // correct here (not Argon2id): refresh tokens are high-entropy random
  // values, not guessable human passwords, so there's nothing to slow down
  // brute-forcing of. See Q4 for the full reasoning.
  @Column({ name: 'token_hash', unique: true })
  tokenHash: string;

  // Groups every token descended from one original login, so a reuse
  // event can revoke the whole chain with one indexed UPDATE.
  @Index()
  @Column({ name: 'family_id' })
  familyId: string;

  // Fixed at creation time — never recalculated/extended in place.
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
