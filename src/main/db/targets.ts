import { getPrisma } from './client'
import { Prisma, type Target } from '../../generated/prisma/client'
import type { CreateTargetInput, UpdateTargetInput } from '../../shared/types'

export async function createTarget(input: CreateTargetInput): Promise<Target> {
  const name = input.name.trim()
  const host = input.host.trim()
  if (!name || !host) {
    throw new Error('Target name and host are required')
  }

  try {
    // New targets go at the end of the list, not sortOrder 0 (which would
    // otherwise put every new target first).
    const last = await getPrisma().target.findFirst({ orderBy: { sortOrder: 'desc' } })
    const sortOrder = (last?.sortOrder ?? -1) + 1
    return await getPrisma().target.create({ data: { name, host, sortOrder } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(`A target for host "${host}" already exists`)
    }
    throw error
  }
}

export async function updateTarget(input: UpdateTargetInput): Promise<Target> {
  const name = input.name.trim()
  const host = input.host.trim()
  if (!name || !host) {
    throw new Error('Target name and host are required')
  }

  try {
    return await getPrisma().target.update({ where: { id: input.id }, data: { name, host } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(`A target for host "${host}" already exists`)
    }
    throw error
  }
}

export async function listTargets(): Promise<Target[]> {
  return getPrisma().target.findMany({ orderBy: { sortOrder: 'asc' } })
}

/** Cascade-deletes the target's ping history, hop history, and alert rules too (see schema.prisma). */
export async function deleteTarget(id: string): Promise<void> {
  await getPrisma().target.delete({ where: { id } })
}

/**
 * Applies a full reordering in one go (rather than a single up/down swap) -
 * the caller (sidebar's move-up/move-down buttons) computes the new order
 * client-side and sends the complete list of target ids, which becomes
 * simply "assign sortOrder = its index here". A transaction keeps every
 * target's sortOrder mutually consistent even if the app is killed mid-way.
 */
export async function reorderTargets(orderedIds: string[]): Promise<void> {
  await getPrisma().$transaction(
    orderedIds.map((id, index) =>
      getPrisma().target.update({ where: { id }, data: { sortOrder: index } })
    )
  )
}

export async function setTargetShowInOverview(
  id: string,
  showInOverview: boolean
): Promise<Target> {
  return getPrisma().target.update({ where: { id }, data: { showInOverview } })
}
