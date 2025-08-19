-- CreateTable
CREATE TABLE "public"."repository_owners" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userLogin" TEXT NOT NULL,
    "userName" TEXT,
    "userEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_owners_repoFullName_key" ON "public"."repository_owners"("repoFullName");

-- CreateIndex
CREATE INDEX "repository_owners_repoFullName_idx" ON "public"."repository_owners"("repoFullName");
