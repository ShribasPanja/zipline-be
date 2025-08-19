-- AlterTable
ALTER TABLE "public"."pipeline_runs" ADD COLUMN     "triggerUserId" TEXT,
ADD COLUMN     "triggerUserLogin" TEXT;
