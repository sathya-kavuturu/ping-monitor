import ping from 'ping'

// Kept comfortably under the engine's 1s tick so a single slow/lost probe
// can't still be in flight when the next tick fires - otherwise the
// engine's in-flight guard skips that tick, silently halving the
// effective cadence for exactly the unreachable targets where a
// consistent cadence matters most.
const PING_TIMEOUT_SECONDS = 0.8

// Belt-and-suspenders on top of PING_TIMEOUT_SECONDS: that option only
// becomes a `-w`/`-W` flag passed to the OS `ping` command, which (at least
// on Windows) bounds just the ICMP echo-reply wait - NOT the hostname
// resolution `ping` does first. A stalled DNS lookup can make a single
// probe run for several seconds despite the configured timeout, and since
// the engine skips any tick that overlaps an in-flight probe (see
// engine.ts), that turns into a multi-second gap with literally zero
// samples recorded - not the same as an ordinary lost packet, which still
// gets its own `null` sample. Racing a hard JS-side timeout on top closes
// that gap: `probeLatency` now always settles within budget no matter what
// the OS command is doing.
//
// The `ping` package doesn't expose the child process it spawns, so this
// can't forcibly kill it, only stop waiting on it - which is enough: once
// this timeout wins, nothing is awaiting that process anymore, so it can
// never block (or cause skipping of) another tick. It exits on its own
// shortly after, bounded by the OS resolver's own timeout, not indefinitely.
const HARD_TIMEOUT_MS = (PING_TIMEOUT_SECONDS + 0.2) * 1000

function withHardTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms)
    })
  ])
}

/**
 * Sends one ICMP echo via the OS `ping` command and returns the round-trip
 * time in ms, or `null` if the packet was lost/timed out/overran its
 * budget - the same shape `savePingRollup` already expects for a lost
 * sample.
 */
export async function probeLatency(host: string): Promise<number | null> {
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
