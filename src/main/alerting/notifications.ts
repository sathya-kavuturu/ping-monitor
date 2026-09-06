import { Notification } from 'electron'
import type { AlertMetric } from '../../shared/types'
import type { AlertEvent } from './watchdog'

const METRIC_LABELS: Record<AlertMetric, string> = {
  packet_loss: 'Packet loss',
  latency: 'Latency'
}

function formatValue(metric: AlertMetric, value: number): string {
  return metric === 'packet_loss' ? `${Math.round(value)}%` : `${Math.round(value)} ms`
}

/**
 * Renders one `AlertEvent` as a native OS notification (Electron's
 * `Notification` API - Action Center on Windows, Notification Center on
 * macOS, libnotify on Linux). Clicking it runs `onClick`, so the user can
 * jump straight back to the dashboard from the tray.
 */
export function notifyAlertEvent(event: AlertEvent, onClick: () => void): void {
  const metricLabel = METRIC_LABELS[event.rule.metric]
  const thresholdText = formatValue(event.rule.metric, event.rule.thresholdValue)
  const valueText = formatValue(event.rule.metric, event.currentValue)

  const title = event.kind === 'triggered' ? `Alert: ${event.target.name}` : `Recovered: ${event.target.name}`
  const body =
    event.kind === 'triggered'
      ? `${metricLabel} is ${valueText}, above your ${thresholdText} threshold.`
      : `${metricLabel} is back to ${valueText}, below your ${thresholdText} threshold.`

  // Worth keeping permanently, not just for debugging: a support-facing
  // trail of what the watchdog decided, independent of whether the OS
  // actually rendered a toast for it.
  console.log(`[watchdog] ${title} - ${body}`)

  if (!Notification.isSupported()) {
    console.warn('Native notifications are not supported in this environment; alert suppressed.')
    return
  }

  const notification = new Notification({ title, body })
  notification.on('click', onClick)
  notification.show()
}
