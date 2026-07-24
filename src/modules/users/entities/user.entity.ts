import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../roles/entities/role.entity';

// Matches the frontend's UserStatus type exactly
// (frontend/src/entities/user/model/user.types.ts).
export enum UserStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PENDING = 'Pending',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // UNIQUE at the DB level (not just checked in app code) — closes the
  // TOCTOU race a pure application-level check can't. Also the index that
  // makes every login's lookup fast. See docs/qa/phase-2-...md Q5/Q6.
  @Column({ unique: true })
  email: string;

  // Nullable: an Admin-invited user has no password until they accept the
  // invite and set one (see docs/PRD.md Workflow 6). Never serialized in a
  // response — requires the global ClassSerializerInterceptor, added in
  // Phase 3 once there's an actual response to serialize.
  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'last_active', type: 'timestamptz', nullable: true })
  lastActive: Date | null;

  @Column({ name: 'role_id' })
  roleId: string;

  // Many-to-one: many users can share one role. RESTRICT — a role in use
  // cannot be deleted out from under its users.
  @ManyToOne(() => Role, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Soft delete only — never a hard DELETE. See docs/qa/phase-2-...md Q10:
  // a hard delete either fails on the orders/audit_logs FK, cascades away
  // history it shouldn't, or orphans records that need to keep pointing at
  // "who did this."
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
