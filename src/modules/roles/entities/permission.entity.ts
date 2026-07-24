import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A flat, reusable list of atomic capabilities (e.g. "products:read").
// Deliberately has no roleId column — a permission belongs to zero or more
// roles via the role_permissions join table (see role.entity.ts), never to
// exactly one. See docs/qa/phase-2-schema-migrations-understanding-check.md
// Q1/Q2 for why a direct FK column here would be the wrong cardinality.
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
