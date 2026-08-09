import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductsAndOrders1786298413782 implements MigrationInterface {
    name = 'AddProductsAndOrders1786298413782'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying NOT NULL, "name" character varying NOT NULL, "category" character varying NOT NULL, "price" numeric(10,2) NOT NULL, "stock_quantity" integer NOT NULL DEFAULT '0', "image_url" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_c44ac33a05b144dd0d9ddcf9327" UNIQUE ("sku"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c3932231d2385ac248d0888d95" ON "products" ("category") `);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customer_name" character varying NOT NULL, "customer_email" character varying NOT NULL, "status" "public"."orders_status_enum" NOT NULL DEFAULT 'Pending', "total_amount" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c3932231d2385ac248d0888d95"`);
        await queryRunner.query(`DROP TABLE "products"`);
    }

}
