import { getPrisma } from './client'
import { Prisma, type Target } from '../../generated/prisma/client'
import type { CreateTargetInput } from '../../shared/types'

export async function createTarget(input: CreateTargetInput): Promise<Target> {
  const name = input.name.trim()
  const host = input.host.trim()
  if (!name || !host) {
    throw new Error('Target name and host are required')
  }

  try {
    return await getPrisma().target.create({ data: { name, host } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(`A target for host "${host}" already exists`)
    }
    throw error
  }
}

export async function listTargets(): Promise<Target[]> {
  return getPrisma().target.findMany({ orderBy: { createdAt: 'asc' } })
}

/** Cascade-deletes the target's ping history, hop history, and alert rules too (see schema.prisma). */
export async function deleteTarget(id: string): Promise<void> {
  await getPrisma().target.delete({ where: { id } })
}
