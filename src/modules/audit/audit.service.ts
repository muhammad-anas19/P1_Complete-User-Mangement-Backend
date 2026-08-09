import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface RecordAuditEntry {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

// Called explicitly from service methods at the exact point a meaningful,
// nameable business event is known — not a generic interceptor watching
// for "any mutating request." See
// docs/qa/phase-5-hardening-understanding-check.md C3.
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async record(entry: RecordAuditEntry): Promise<void> {
    await this.auditLogRepo.save(
      this.auditLogRepo.create({
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? null,
      }),
    );
  }
}
