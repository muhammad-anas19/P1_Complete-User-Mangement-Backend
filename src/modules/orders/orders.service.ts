import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { buildPaginatedResult, getSkip, PaginatedResult } from '../../common/utils/pagination.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Order } from './entities/order.entity';

const SORTABLE_FIELDS = ['customerName', 'totalAmount', 'createdAt', 'status'] as const;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepo: Repository<Order>,
  ) {}

  async findAll(query: ListOrdersQueryDto): Promise<PaginatedResult<Order>> {
    const { page, limit, search, sort, status } = query;

    const qb = this.ordersRepo.createQueryBuilder('order');

    if (search) {
      qb.andWhere('(order.customerName ILIKE :search OR order.customerEmail ILIKE :search)', {
        search: `%${search}%`,
      });
    }
    if (status && status !== 'All') {
      qb.andWhere('order.status = :status', { status });
    }

    if (sort) {
      const [field, direction] = sort.split('_');
      if ((SORTABLE_FIELDS as readonly string[]).includes(field)) {
        qb.orderBy(`order.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
      }
    } else {
      qb.orderBy('order.createdAt', 'DESC');
    }

    qb.skip(getSkip(page, limit)).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return buildPaginatedResult(data, total, page, limit);
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepo.findOneBy({ id });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async create(dto: CreateOrderDto): Promise<Order> {
    const order = this.ordersRepo.create(dto);
    return this.ordersRepo.save(order);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<Order> {
    const order = await this.findOne(id);
    Object.assign(order, dto);
    return this.ordersRepo.save(order);
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.findOne(id);
    order.status = dto.status;
    return this.ordersRepo.save(order);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.findOne(id);
    await this.ordersRepo.softDelete(id);
    return { deleted: true };
  }
}
