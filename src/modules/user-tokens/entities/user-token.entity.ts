import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum UserTokenPurpose {
  EMAIL_VERIFICATION = 'email_verification',
  INVITE = 'invite',
  PASSWORD_RESET = 'password_reset',
}

// One table, one purpose enum, reused across signup/accept-invite/
// forgot-password instead of cluttering User with token-specific columns —
// same design philosophy as refresh_tokens getting its own table (Phase 2).
// Single-use (usedAt marks consumption) — no rotation/family concept needed
// here, unlike refresh tokens, since each of these flows is a one-shot
// action, not an ongoing session.
@Entity('user_tokens')
export class UserToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', unique: true })
  tokenHash: string;

  @Column({ type: 'enum', enum: UserTokenPurpose })
  purpose: UserTokenPurpose;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
