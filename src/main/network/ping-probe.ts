import ping from 'ping'
import { isNativeIcmpAvailable, probeLatencyNative } from './icmp-windows'
import { resolveIPv4 } from './resolve-ipv4'

// Was 0.8s, kept deliberately under the engine's 1s tick on the theory that
// a probe still in flight when the next tick fired would otherwise get
// skipped. In practice that just traded a smaller problem for a bigger one:
// measuring plain 8.8.8.8 in isolation (no other targets, no traceroute)
// against an 800ms timeout showed a steady 2-3% "loss" rate that was
// actually genuine round trips landing a little past 800ms, not real
// packet loss - raising the timeout to 3s with nothing else changed made it
// disappear entirely (0 lost out of ~300 probes). 3s is comfortably OVER
// the 1s tick, which is fine even though engine.ts DOES still skip a tick
// for a target whose own previous probe hasn't resolved yet (see the
// `pingInFlight` comment there) - that guard only ever delays how often a
// slow-but-real reply gets sampled, never turns it into a false loss.
const PING_TIMEOUT_SECONDS = 3
const PING_TIMEOUT_MS = PING_TIMEOUT_SECONDS * 1000

// Belt-and-suspenders on top of PING_TIMEOUT_SECONDS/PING_TIMEOUT_MS: on the
// subprocess fallback path, that value only becomes a `-w`/`-W` flag passed
// to the OS `ping` command, which (at least on Windows) bounds just the
// ICMP echo-reply wait - NOT the hostname resolution `ping` does first. A
// stalled DNS lookup can make a single probe run well past the configured
// timeout with nothing to show for it. Racing a hard JS-side timeout on top
// closes that gap: `probeLatency` now always settles within budget no
// matter what the OS command is doing, recording an ordinary `null` (lost)
// sample instead of leaving this tick waiting indefinitely.
//
// The `ping` package doesn't expose the child process it spawns, so this
// can't forcibly kill it, only stop waiting on it - which is enough: once
// this timeout wins, nothing is awaiting that process anymore. It exits on
// its own shortly after, bounded by the OS resolver's own timeout, not
// indefinitely.
const HARD_TIMEOUT_MS = (PING_TIMEOUT_SECONDS + 0.2) * 1000

function withHardTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms)
    })
  ])
}

async function probeLatencySubprocess(host: string): Promise<number | null> {
  try {
    const result = await withHardTimeout(
      ping.promise.probe(host, {
        timeout: PING_TIMEOUT_SECONDS,
        min_reply: 1
      }),
      HARD_TIMEOUT_MS
    )

    if (!result || !result.alive) return null
    return typeof result.time === 'number' && Number.isFinite(result.time) ? result.time : null
  } catch (error) {
    console.error(`Ping probe failed for ${host}:`, error)
    return null
  }
}

/**
 * Sends one ICMP echo and returns the round-trip time in ms, or `null` if
 * the packet was lost/timed out/overran its budget - the same shape
 * `savePingRollup` already expects for a lost sample.
 *
 * On Windows, this goes through `icmp-windows.ts`'s native ICMP path first:
 * one persistent handle reused across every probe (the same technique
 * PingPlotter uses), instead of spawning an OS `ping` process per probe.
 * That removes process-spawn/scheduling jitter as a source of probes that
 * were actually answered in time but got recorded as loss anyway. Anything
 * that path can't handle (non-Windows, an AAAA-only host, or the native
 * path failing to initialize at all) falls back to the original
 * subprocess-based prober further down.
 */
export async function probeLatency(host: string): Promise<number | null> {
  if (isNativeIcmpAvailable()) {
    const ipv4 = await resolveIPv4(host)
    if (ipv4) {
      try {
        return await withHardTimeout(probeLatencyNative(ipv4, PING_TIMEOUT_MS), HARD_TIMEOUT_MS)
      } catch (error) {
        console.error(`Native ICMP probe failed for ${host}, falling back to OS ping:`, error)
      }
    }
  }

  return probeLatencySubprocess(host)
}
