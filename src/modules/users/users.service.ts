import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, IsNull } from 'typeorm';
import { buildPaginatedResult, getSkip, PaginatedResult } from '../../common/utils/pagination.util';
import { Role } from '../roles/entities/role.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { AuditService } from '../audit/audit.service';
import { UserTokensService } from '../user-tokens/user-tokens.service';
import { UserTokenPurpose } from '../user-tokens/entities/user-token.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const SORTABLE_FIELDS = ['name', 'email', 'createdAt', 'lastActive'] as const;
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly auditService: AuditService,
    private readonly userTokensService: UserTokensService,
  ) {}

  async findAll(query: ListUsersQueryDto): Promise<PaginatedResult<User>> {
    const { page, limit, search, sort, role, status } = query;

    const qb = this.usersRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role');

    if (search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${search}%`,
      });
    }
    if (role && role !== 'All') {
      qb.andWhere('role.name = :role', { role });
    }
    if (status && status !== 'All') {
      qb.andWhere('user.status = :status', { status });
    }

    // Sort field validated against an explicit allow-list — never
    // interpolated directly. See docs/design.md Section 4.
    if (sort) {
      const [field, direction] = sort.split('_');
      if ((SORTABLE_FIELDS as readonly string[]).includes(field)) {
        qb.orderBy(`user.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
      }
    } else {
      qb.orderBy('user.createdAt', 'DESC');
    }

    qb.skip(getSkip(page, limit)).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return buildPaginatedResult(data, total, page, limit);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepo.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    const role = await this.rolesRepo.findOneBy({ id: dto.roleId });
    if (!role) {
      throw new BadRequestException('Invalid roleId');
    }

    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      roleId: dto.roleId,
      passwordHash: null,
    });

    let saved: User;
    try {
      saved = await this.usersRepo.save(user);
    } catch (error) {
      // DB-level UNIQUE constraint is the real enforcement (closes the
      // TOCTOU race a pre-check alone can't) — see
      // docs/qa/phase-2-schema-migrations-understanding-check.md Q5.
      // Translated here into a clean 409 instead of leaking a raw
      // Postgres error via AllExceptionsFilter's generic 500 path.
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }

    // save() returns exactly what was passed in plus generated columns —
    // it does NOT re-run a SELECT, so the `role` eager relation (only
    // applied by find-family queries) is never populated here. Every other
    // endpoint (findOne/findAll/update, since update() loads via findOne()
    // first) returns a User with `role` populated, so callers — including
    // the frontend's toUser() adapter, which reads `role.name` — can rely
    // on it always being present. We already fetched the full Role above
    // to validate roleId; reuse it instead of a second query.
    saved.role = role;

    // Real invite token — real email sending stays mocked (logged), same
    // disclosed boundary as everywhere else "send a real email" comes up.
    // See docs/phases.md Phase 8.
    const inviteToken = await this.userTokensService.issueUrlToken(
      saved.id,
      UserTokenPurpose.INVITE,
    );
    this.logger.log(
      `[MOCK EMAIL] Invite link for ${saved.email}: /accept-invite?token=${inviteToken}`,
    );

    return saved;
  }

  async update(id: string, dto: UpdateUserDto, actorUserId: string): Promise<User> {
    const user = await this.findOne(id);
    const previousRoleId = user.roleId;

    if (dto.roleId) {
      const role = await this.rolesRepo.findOneBy({ id: dto.roleId });
      if (!role) {
        throw new BadRequestException('Invalid roleId');
      }
      // Object.assign below only overwrites `roleId` (dto has no `role`
      // key) — without this, `user.role` would keep pointing at the OLD
      // role object even though `roleId` is correctly updated in the DB.
      // Same class of bug as create()'s save()-doesn't-reselect issue above.
      user.role = role;
    }

    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);

    // Recorded as an explicit, meaningful business event — not "a PATCH
    // happened" — and only when a role actually changed, not on every
    // update. See docs/qa/phase-5-hardening-understanding-check.md C2/C3.
    if (dto.roleId && dto.roleId !== previousRoleId) {
      await this.auditService.record({
        actorUserId,
        action: 'user.role_changed',
        targetType: 'User',
        targetId: id,
        metadata: { fromRoleId: previousRoleId, toRoleId: dto.roleId },
      });
    }

    return saved;
  }

  async remove(id: string, actorUserId: string): Promise<{ deleted: true }> {
    await this.findOne(id); // 404s if missing/already soft-deleted

    // Soft delete only — never a hard DELETE. See
    // docs/qa/phase-2-schema-migrations-understanding-check.md Q10.
    await this.usersRepo.softDelete(id);

    // Removing access and preserving history are two different actions;
    // both need to happen. See docs/qa/phase-4-...md Q7.
    await this.refreshTokenRepo.update(
      { userId: id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    await this.auditService.record({
      actorUserId,
      action: 'user.deleted',
      targetType: 'User',
      targetId: id,
    });

    return { deleted: true };
  }
}
