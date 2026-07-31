import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository, IsNull } from 'typeorm';
import { buildPaginatedResult, getSkip, PaginatedResult } from '../../common/utils/pagination.util';
import { Role } from '../roles/entities/role.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const SORTABLE_FIELDS = ['name', 'email', 'createdAt', 'lastActive'] as const;
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
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

    try {
      return await this.usersRepo.save(user);
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
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (dto.roleId) {
      const role = await this.rolesRepo.findOneBy({ id: dto.roleId });
      if (!role) {
        throw new BadRequestException('Invalid roleId');
      }
    }

    Object.assign(user, dto);
    return this.usersRepo.save(user);
  }

  async remove(id: string): Promise<{ deleted: true }> {
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

    return { deleted: true };
  }
}
