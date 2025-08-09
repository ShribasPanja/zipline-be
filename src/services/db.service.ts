import { PrismaClient } from "@prisma/client";

class DbServiceImpl {
  private prisma?: PrismaClient;

  isEnabled(): boolean {
    return !!process.env.DATABASE_URL;
  }

  getClient(): PrismaClient | undefined {
    if (!this.isEnabled()) return undefined;
    if (!this.prisma) {
      this.prisma = new PrismaClient();
    }
    return this.prisma;
  }

  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = undefined;
    }
  }
}

export const DbService = new DbServiceImpl();
