import { Expose } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type StockStatus = 'out_of_stock' | 'low_stock' | 'in_stock';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  sku: string;

  @Column()
  name: string;

  // Plain indexed string, not its own entity — see
  // docs/qa/phase-6-7-products-orders-understanding-check.md Q3.
  @Index()
  @Column()
  category: string;

  // numeric(10,2), returned by pg as a string — never `number` for money.
  // See Q1.
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: string;

  @Column({ name: 'stock_quantity', type: 'int', default: 0 })
  stockQuantity: number;

  // Deliberately no stockStatus column — a pure function of stockQuantity,
  // computed fresh on every read so it can never drift out of sync with the
  // number it's derived from. @Expose() makes instanceToPlain() include it
  // in API responses despite it not being a real column. See
  // docs/qa/phase-6-7-products-orders-understanding-check.md Q2.
  @Expose()
  get stockStatus(): StockStatus {
    if (this.stockQuantity <= 0) return 'out_of_stock';
    if (this.stockQuantity < 10) return 'low_stock';
    return 'in_stock';
  }

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
