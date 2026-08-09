import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  // Only id+name — used by the frontend to resolve a role name (the only
  // thing users/create-user forms know) to the roleId the users endpoints
  // actually require. Permissions are irrelevant here, so they're left off.
  findAll(): Promise<Pick<Role, 'id' | 'name'>[]> {
    return this.rolesRepository.find({
      select: ['id', 'name'],
      order: { name: 'ASC' },
    });
  }
}
