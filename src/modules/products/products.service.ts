import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { buildPaginatedResult, getSkip, PaginatedResult } from '../../common/utils/pagination.util';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

const SORTABLE_FIELDS = ['name', 'price', 'stockQuantity', 'createdAt'] as const;
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly productsRepo: Repository<Product>,
  ) {}

  async findAll(query: ListProductsQueryDto): Promise<PaginatedResult<Product>> {
    const { page, limit, search, sort, category } = query;

    const qb = this.productsRepo.createQueryBuilder('product');

    if (search) {
      qb.andWhere('(product.name ILIKE :search OR product.sku ILIKE :search)', {
        search: `%${search}%`,
      });
    }
    if (category) {
      qb.andWhere('product.category = :category', { category });
    }

    if (sort) {
      const [field, direction] = sort.split('_');
      if ((SORTABLE_FIELDS as readonly string[]).includes(field)) {
        qb.orderBy(`product.${field}`, direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
      }
    } else {
      qb.orderBy('product.createdAt', 'DESC');
    }

    qb.skip(getSkip(page, limit)).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return buildPaginatedResult(data, total, page, limit);
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productsRepo.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const product = this.productsRepo.create(dto);
    try {
      return await this.productsRepo.save(product);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('A product with this SKU already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    return this.productsRepo.save(product);
  }

  async setImage(id: string, imageUrl: string): Promise<Product> {
    const product = await this.findOne(id);
    product.imageUrl = imageUrl;
    return this.productsRepo.save(product);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    await this.findOne(id);
    await this.productsRepo.softDelete(id);
    return { deleted: true };
  }
}
