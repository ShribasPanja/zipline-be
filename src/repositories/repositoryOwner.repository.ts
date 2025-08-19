import { DbService } from "../services/db.service";

export type CreateRepositoryOwnerInput = {
  repoFullName: string;
  userId: string;
  userLogin: string;
  userName?: string;
  userEmail?: string;
};

export type UpdateRepositoryOwnerInput = {
  userId?: string;
  userLogin?: string;
  userName?: string;
  userEmail?: string;
};

export const RepositoryOwnerRepository = {
  async create(input: CreateRepositoryOwnerInput) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.repositoryOwner.create({
        data: {
          repoFullName: input.repoFullName,
          userId: input.userId,
          userLogin: input.userLogin,
          userName: input.userName,
          userEmail: input.userEmail,
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to create repository owner:", error);
      return undefined;
    }
  },

  async findByRepoFullName(repoFullName: string) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.repositoryOwner.findUnique({
        where: { repoFullName },
      });
    } catch (error) {
      console.warn("[DB] Failed to find repository owner:", error);
      return undefined;
    }
  },

  async upsert(repoFullName: string, input: CreateRepositoryOwnerInput) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.repositoryOwner.upsert({
        where: { repoFullName },
        update: {
          userId: input.userId,
          userLogin: input.userLogin,
          userName: input.userName,
          userEmail: input.userEmail,
        },
        create: {
          repoFullName: input.repoFullName,
          userId: input.userId,
          userLogin: input.userLogin,
          userName: input.userName,
          userEmail: input.userEmail,
        },
      });
    } catch (error) {
      console.warn("[DB] Failed to upsert repository owner:", error);
      return undefined;
    }
  },

  async delete(repoFullName: string) {
    const prisma = DbService.getClient();
    if (!prisma) return undefined;
    try {
      return await prisma.repositoryOwner.delete({
        where: { repoFullName },
      });
    } catch (error) {
      console.warn("[DB] Failed to delete repository owner:", error);
      return undefined;
    }
  },
};
