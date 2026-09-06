import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AlertMetric, AlertRule } from '../../../shared/types'

interface AlertRulesProps {
  targetId: string
}

const METRIC_OPTIONS: Array<{ value: AlertMetric; label: string; unit: string; placeholder: string }> = [
  { value: 'packet_loss', label: 'Packet loss', unit: '%', placeholder: '5' },
  { value: 'latency', label: 'Latency', unit: 'ms', placeholder: '200' }
]

function metricMeta(metric: AlertMetric) {
  return METRIC_OPTIONS.find((option) => option.value === metric) ?? METRIC_OPTIONS[0]
}

/**
 * Lets the user configure the thresholds `AlertWatchdog` (main process)
 * evaluates against the live stream - e.g. "packet loss > 5%". Purely a
 * thin CRUD view over the `alert-rules:*` IPC channels; all the actual
 * evaluation, debouncing, and notification happens in the main process
 * regardless of whether this window is even open.
 */
function AlertRules({ targetId }: AlertRulesProps): React.JSX.Element {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [metric, setMetric] = useState<AlertMetric>('packet_loss')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(() => {
    window.api
      .getAlertRules(targetId)
      .then(setRules)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load alert rules')
      })
  }, [targetId])

  useEffect(() => {
    load()
  }, [load])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const thresholdValue = Number(threshold)
    if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
      setError('Enter a positive threshold value')
      return
    }

    setError(null)
    setIsSaving(true)
    window.api
      .createAlertRule({ targetId, metric, thresholdValue })
      .then(() => {
        setThreshold('')
        load()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to create alert rule')
      })
      .finally(() => setIsSaving(false))
  }

  const handleToggle = (rule: AlertRule): void => {
    window.api
      .setAlertRuleEnabled(rule.id, !rule.enabled)
      .then(load)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to update alert rule')
      })
  }

  const handleDelete = (rule: AlertRule): void => {
    window.api
      .deleteAlertRule(rule.id)
      .then(load)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to delete alert rule')
      })
  }

  const selectedMeta = metricMeta(metric)

  return (
    <section className="feed">
      <h2>Alerts</h2>
      {error && <p className="sidebar-error">{error}</p>}

      <ul className="alert-rule-list">
        {rules.map((rule) => {
          const meta = metricMeta(rule.metric)
          return (
            <li key={rule.id} className={`alert-rule-item ${rule.enabled ? '' : 'alert-rule-item--disabled'}`}>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => handleToggle(rule)}
                title={rule.enabled ? 'Enabled - click to disable' : 'Disabled - click to enable'}
              />
              <span className="alert-rule-text">
                {meta.label} &gt; {rule.thresholdValue}
                {meta.unit}
              </span>
              <button
                type="button"
                className="alert-rule-delete"
                onClick={() => handleDelete(rule)}
                aria-label="Delete rule"
              >
                ×
              </button>
            </li>
          )
        })}
        {rules.length === 0 && <li className="feed-empty">No alert rules configured for this target.</li>}
      </ul>

      <form className="alert-rule-form" onSubmit={handleSubmit}>
        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value as AlertMetric)}
          disabled={isSaving}
        >
          {METRIC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="alert-rule-form-operator">&gt;</span>
        <input
          type="number"
          min="0"
          step="any"
          placeholder={selectedMeta.placeholder}
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          disabled={isSaving}
        />
        <span className="alert-rule-form-unit">{selectedMeta.unit}</span>
        <button type="submit" disabled={isSaving || !threshold}>
          Add
        </button>
      </form>
    </section>
  )
}

export default AlertRules
