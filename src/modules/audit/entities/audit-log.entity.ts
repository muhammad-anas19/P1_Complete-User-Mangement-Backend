import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Deliberately NO foreign keys on actor_user_id / target_id — the audit
// trail must outlive the lifecycle of whoever/whatever it references. See
// docs/qa/phase-5-hardening-understanding-check.md C1.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  // e.g. 'user.deleted', 'user.role_changed'
  @Column()
  action: string;

  // e.g. 'User' — which kind of entity this action was performed on
  @Column({ name: 'target_type' })
  targetType: string;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
