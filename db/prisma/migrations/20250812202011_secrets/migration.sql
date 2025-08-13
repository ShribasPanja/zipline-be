-- CreateTable
CREATE TABLE "public"."repository_secrets" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repository_secrets_repoFullName_idx" ON "public"."repository_secrets"("repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "repository_secrets_repoFullName_key_key" ON "public"."repository_secrets"("repoFullName", "key");
