import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuditLogs1786296198750 implements MigrationInterface {
    name = 'AddAuditLogs1786296198750'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_user_id" uuid, "action" character varying NOT NULL, "target_type" character varying NOT NULL, "target_id" uuid, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
