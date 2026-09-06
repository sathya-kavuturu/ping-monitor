import ping from 'ping'

// Kept comfortably under the engine's 1s tick so a single slow/lost probe
// can't still be in flight when the next tick fires - otherwise the
// engine's in-flight guard skips that tick, silently halving the
// effective cadence for exactly the unreachable targets where a
// consistent cadence matters most.
const PING_TIMEOUT_SECONDS = 0.8

/**
 * Sends one ICMP echo via the OS `ping` command and returns the round-trip
 * time in ms, or `null` if the packet was lost/timed out - the same
 * shape `savePingRollup` already expects for a lost sample.
 */
export async function probeLatency(host: string): Promise<number | null> {
  try {
    const result = await ping.promise.probe(host, {
      timeout: PING_TIMEOUT_SECONDS,
      min_reply: 1
    })

    if (!result.alive) return null
    return typeof result.time === 'number' && Number.isFinite(result.time) ? result.time : null
  } catch (error) {
    console.error(`Ping probe failed for ${host}:`, error)
    return null
  }
}
