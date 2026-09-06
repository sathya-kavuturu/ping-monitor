import { getPrisma } from './client'
import type { AlertRule as PrismaAlertRule } from '../../generated/prisma/client'
import type { AlertMetric, AlertRule, CreateAlertRuleInput } from '../../shared/types'

const VALID_METRICS: ReadonlySet<AlertMetric> = new Set(['packet_loss', 'latency'])

// The DB column is a plain string (SQLite has no enum type), so reads need
// a cast back to the narrow union - safe here because every row was written
// through `createAlertRule`, which validates it below.
function toAlertRule(row: PrismaAlertRule): AlertRule {
  return { ...row, metric: row.metric as AlertMetric }
}

function assertValidInput(input: CreateAlertRuleInput): void {
  if (!VALID_METRICS.has(input.metric)) {
    throw new Error(`Unknown alert metric "${input.metric}"`)
  }
  if (!Number.isFinite(input.thresholdValue) || input.thresholdValue <= 0) {
    throw new Error('Threshold must be a positive number')
  }
  if (input.metric === 'packet_loss' && input.thresholdValue > 100) {
    throw new Error('Packet loss threshold must be at most 100')
  }
}

export async function createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
  assertValidInput(input)
  const row = await getPrisma().alertRule.create({
    data: {
      targetId: input.targetId,
      metric: input.metric,
      thresholdValue: input.thresholdValue
    }
  })
  return toAlertRule(row)
}

/** All rules across every target when `targetId` is omitted - used by the watchdog at startup. */
export async function listAlertRules(targetId?: string): Promise<AlertRule[]> {
  const rows = await getPrisma().alertRule.findMany({
    where: targetId ? { targetId } : undefined,
    orderBy: { createdAt: 'asc' }
  })
  return rows.map(toAlertRule)
}

export async function setAlertRuleEnabled(id: string, enabled: boolean): Promise<AlertRule> {
  const row = await getPrisma().alertRule.update({ where: { id }, data: { enabled } })
  return toAlertRule(row)
}

export async function deleteAlertRule(id: string): Promise<void> {
  await getPrisma().alertRule.delete({ where: { id } })
}
