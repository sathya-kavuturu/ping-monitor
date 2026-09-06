import { spawn } from 'child_process'
import type { HopSample } from '../../shared/types'

const MAX_HOPS = 30
const PER_HOP_TIMEOUT_SECONDS = 1
// Worst case is roughly MAX_HOPS * PER_HOP_TIMEOUT_SECONDS * probesPerHop -
// Unix gets 1 probe/hop (-q 1), but Windows `tracert` has no equivalent flag
// and always sends 3 probes/hop, so an unresponsive hop costs 3x the
// per-hop timeout there. Kill the process well before the true worst case
// so one unreachable target can't wedge the engine's traceroute cadence.
const OVERALL_TIMEOUT_MS = 45_000

function buildCommand(host: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    // -d: don't resolve hostnames (avoids slow/hanging reverse DNS per hop)
    // -h: max hops, -w: per-hop timeout in ms
    return {
      command: 'tracert',
      args: ['-d', '-h', String(MAX_HOPS), '-w', String(PER_HOP_TIMEOUT_SECONDS * 1000), host]
    }
  }

  // Linux (GNU) and macOS (BSD) traceroute accept the same relevant flags.
  // -n: numeric only, -m: max hops, -q: probes per hop, -w: per-hop timeout (s)
  return {
    command: 'traceroute',
    args: ['-n', '-m', String(MAX_HOPS), '-q', '1', '-w', String(PER_HOP_TIMEOUT_SECONDS), host]
  }
}

function parseUnixLine(line: string): HopSample | null {
  const trimmed = line.trim()
  const match = trimmed.match(/^(\d+)\s+(.*)$/)
  if (!match) return null

  const hopNumber = Number(match[1])
  const rest = match[2].trim()

  if (rest === '' || /^\*(\s+\*)*$/.test(rest)) {
    return { hopNumber, address: null, hostname: null, latencyMs: null }
  }

  // Usually just a bare numeric address (we pass -n), but tolerate the
  // "hostname (address)" form in case a build ignores it.
  let address: string | null = null
  let hostname: string | null = null
  let remainder = rest

  const withHostname = rest.match(/^(\S+)\s+\(([^)]+)\)\s*(.*)$/)
  if (withHostname) {
    hostname = withHostname[1]
    address = withHostname[2]
    remainder = withHostname[3]
  } else {
    const bareAddress = rest.match(/^(\S+)\s*(.*)$/)
    if (bareAddress) {
      address = bareAddress[1]
      remainder = bareAddress[2]
    }
  }

  const timeMatch = remainder.match(/([\d.]+)\s*ms/)
  const latencyMs = timeMatch ? parseFloat(timeMatch[1]) : null

  return { hopNumber, address, hostname, latencyMs }
}

function parseWindowsLine(line: string): HopSample | null {
  const trimmed = line.trim()
  const match = trimmed.match(/^(\d+)\s+(.*)$/)
  if (!match) return null

  const hopNumber = Number(match[1])
  const rest = match[2]

  if (/Request timed out/i.test(rest)) {
    return { hopNumber, address: null, hostname: null, latencyMs: null }
  }

  const times: number[] = []
  const timeRegex = /(\d+)\s*ms/gi
  let timeMatch: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((timeMatch = timeRegex.exec(rest)) !== null) {
    times.push(Number(timeMatch[1]))
  }

  const addressMatch = rest.match(/([A-Za-z0-9.:_-]+)\s*$/)
  const address = addressMatch ? addressMatch[1] : null
  const latencyMs =
    times.length > 0 ? times.reduce((sum, value) => sum + value, 0) / times.length : null

  // We run with -d (no DNS resolution), so there's never a hostname to report.
  return { hopNumber, address, hostname: null, latencyMs }
}

/**
 * Runs the OS `traceroute`/`tracert` and parses its output into one
 * `HopSample` per hop. Best-effort: a hop that never replies still produces
 * a row (`address: null, latencyMs: null`) instead of being dropped, so hop
 * numbering stays accurate for the UI.
 */
export function runTraceroute(host: string): Promise<HopSample[]> {
  const { command, args } = buildCommand(host)
  const parseLine = process.platform === 'win32' ? parseWindowsLine : parseUnixLine

  return new Promise((resolve) => {
    let stdout = ''
    let settled = false

    const finish = (hops: HopSample[]): void => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve(hops)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      console.error(`Failed to start traceroute for ${host}:`, error)
      finish([])
      return
    }

    const killTimer = setTimeout(() => {
      child.kill()
    }, OVERALL_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    child.once('error', (error) => {
      console.error(`Traceroute process error for ${host}:`, error)
      finish([])
    })

    child.once('close', () => {
      const hops = stdout
        .split(/\r?\n/)
        .map(parseLine)
        .filter((hop): hop is HopSample => hop !== null)
      finish(hops)
    })
  })
}
