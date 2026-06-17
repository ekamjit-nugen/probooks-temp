-- Data spine tables (STANDARDS §8.2; SPEC §2). Generated from schema.prisma via
-- `prisma migrate diff` and committed verbatim. Depends on uuid_generate_v7()
-- created in 20260604120000_uuid_v7_function. RLS policies + DB roles are added
-- in the following migration (20260604120200_rls_and_roles).

-- CreateEnum
CREATE TYPE "tenants_status_t" AS ENUM ('none', 'provisioned', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "users_role_t" AS ENUM ('platform_operator', 'firm_admin', 'accountant', 'client_owner', 'client_staff');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "region" TEXT NOT NULL DEFAULT 'ca-central-1',
    "status" "tenants_status_t" NOT NULL DEFAULT 'none',
    "plan_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "role" "users_role_t" NOT NULL,
    "client_id" UUID,
    "idp_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "response_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "rotated_from_jti" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_users_tenant_id" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "ix_users_tenant_id_client_id" ON "users"("tenant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_tenant_idp_subject" ON "users"("tenant_id", "idp_subject");

-- CreateIndex
CREATE INDEX "ix_clients_tenant_id" ON "clients"("tenant_id");

-- CreateIndex
CREATE INDEX "ix_audit_log_tenant_id_created_at" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_log_tenant_entity" ON "audit_log"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "ix_idempotency_keys_expires_at" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_idempotency_keys_tenant_key" ON "idempotency_keys"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "ix_refresh_tokens_tenant_user" ON "refresh_tokens"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_refresh_tokens_tenant_jti" ON "refresh_tokens"("tenant_id", "jti");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-AUTH-3: a client role binds to exactly one client; firm roles carry no
-- client_id. Enforced at the DB as a defense-in-depth CHECK (also in service).
ALTER TABLE "users" ADD CONSTRAINT "ck_users_client_role_binding" CHECK (
  (role IN ('client_owner', 'client_staff') AND client_id IS NOT NULL)
  OR (role IN ('platform_operator', 'firm_admin', 'accountant') AND client_id IS NULL)
);
