import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AlertMetric, AlertRule } from '../../../shared/types'
import type { TargetWithStatus } from '../App'

interface AllAlertsProps {
  targets: TargetWithStatus[]
}

const METRIC_OPTIONS: Array<{
  value: AlertMetric
  label: string
  unit: string
  placeholder: string
}> = [
  { value: 'packet_loss', label: 'Packet loss', unit: '%', placeholder: '5' },
  { value: 'latency', label: 'Latency', unit: 'ms', placeholder: '200' }
]

function metricMeta(metric: AlertMetric) {
  return METRIC_OPTIONS.find((option) => option.value === metric) ?? METRIC_OPTIONS[0]
}

/**
 * The single, consolidated place to see and manage alert rules across every
 * target - replaces the old per-target "Alerts" section that used to
 * re-appear (identically laid out, just re-scoped) every time you selected
 * a different target. Grouped by target here instead, so switching targets
 * in the sidebar no longer means re-navigating to the same UI again.
 */
function AllAlerts({ targets }: AllAlertsProps): React.JSX.Element {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formTargetId, setFormTargetId] = useState('')
  const [metric, setMetric] = useState<AlertMetric>('packet_loss')
  const [threshold, setThreshold] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(() => {
    window.api
      .getAlertRules()
      .then(setRules)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Failed to load alert rules')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    // Keep the form's target selector valid as targets are added/removed.
    setFormTargetId((current) => {
      if (current && targets.some((target) => target.id === current)) return current
      return targets[0]?.id ?? ''
    })
  }, [targets])

  const rulesByTarget = useMemo(() => {
    const map = new Map<string, AlertRule[]>()
    for (const rule of rules) {
      const forTarget = map.get(rule.targetId) ?? []
      forTarget.push(rule)
      map.set(rule.targetId, forTarget)
    }
    return map
  }, [rules])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!formTargetId) {
      setFormError('Add a target first')
      return
    }
    const thresholdValue = Number(threshold)
    if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
      setFormError('Enter a positive threshold value')
      return
    }

    setFormError(null)
    setIsSaving(true)
    window.api
      .createAlertRule({ targetId: formTargetId, metric, thresholdValue })
      .then(() => {
        setThreshold('')
        load()
      })
      .catch((error: unknown) => {
        setFormError(error instanceof Error ? error.message : 'Failed to create alert rule')
      })
      .finally(() => setIsSaving(false))
  }

  const handleToggle = (rule: AlertRule): void => {
    window.api
      .setAlertRuleEnabled(rule.id, !rule.enabled)
      .then(load)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Failed to update alert rule')
      })
  }

  const handleDelete = (rule: AlertRule): void => {
    window.api
      .deleteAlertRule(rule.id)
      .then(load)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : 'Failed to delete alert rule')
      })
  }

  const selectedMeta = metricMeta(metric)

  return (
    <main className="main-content">
      <header className="main-header">
        <h1>Alerts</h1>
      </header>

      {loadError && <p className="sidebar-error">{loadError}</p>}

      {targets.length === 0 && (
        <p className="feed-empty">Add a target to configure alerts for it.</p>
      )}

      {targets.length > 0 && (
        <section className="feed">
          <h2>Add Alert Rule</h2>
          <form className="alert-rule-form" onSubmit={handleSubmit}>
            <select
              value={formTargetId}
              onChange={(event) => setFormTargetId(event.target.value)}
              disabled={isSaving}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
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
          {formError && <p className="sidebar-error">{formError}</p>}
        </section>
      )}

      {targets.map((target) => {
        const targetRules = rulesByTarget.get(target.id) ?? []
        return (
          <section className="feed alerts-group" key={target.id}>
            <div className="feed-header-row">
              <h2>
                {target.name} <span className="route-hostname">({target.host})</span>
              </h2>
            </div>
            <ul className="alert-rule-list">
              {targetRules.map((rule) => {
                const meta = metricMeta(rule.metric)
                return (
                  <li
                    key={rule.id}
                    className={`alert-rule-item ${rule.enabled ? '' : 'alert-rule-item--disabled'}`}
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggle(rule)}
                      title={
                        rule.enabled ? 'Enabled - click to disable' : 'Disabled - click to enable'
                      }
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
              {targetRules.length === 0 && (
                <li className="feed-empty">No alert rules configured for this target.</li>
              )}
            </ul>
          </section>
        )
      })}
    </main>
  )
}

export default AllAlerts
