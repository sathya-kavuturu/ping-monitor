import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/network/ping-probe', () => ({
  probeLatency: vi.fn().mockResolvedValue(10)
}))
vi.mock('../src/main/network/traceroute', () => ({
  runTraceroute: vi.fn().mockResolvedValue([])
}))
vi.mock('../src/main/network/reverse-dns', () => ({
  resolveHopHostnames: vi.fn().mockResolvedValue([])
}))

import { NetworkEngine } from '../src/main/network/engine'
import { probeLatency } from '../src/main/network/ping-probe'

describe('NetworkEngine.sync', () => {
  let engine: NetworkEngine | null = null

  afterEach(() => {
    engine?.stopAll()
    engine = null
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('restarts monitoring against the new host when an existing target is edited', async () => {
    engine = new NetworkEngine({ onSample: () => {} })

    engine.sync([{ id: 't1', host: 'host-a' }])
    await Promise.resolve()
    expect(probeLatency).toHaveBeenLastCalledWith('host-a')

    // Same id, different host - as if the target was renamed/edited, not
    // added or removed. Without the host in the diff, this would keep
    // pinging "host-a" forever.
    engine.sync([{ id: 't1', host: 'host-b' }])
    await Promise.resolve()
    expect(probeLatency).toHaveBeenLastCalledWith('host-b')
  })

  it('does not restart an unchanged target', async () => {
    engine = new NetworkEngine({ onSample: () => {} })

    engine.sync([{ id: 't1', host: 'host-a' }])
    await Promise.resolve()
    vi.mocked(probeLatency).mockClear()

    engine.sync([{ id: 't1', host: 'host-a' }])
    await Promise.resolve()
    // No new immediate probe fired - track()'s "don't wait a full interval
    // for the first sample" tick only happens on (re)start.
    expect(probeLatency).not.toHaveBeenCalled()
  })

  it('stops monitoring a removed target', async () => {
    engine = new NetworkEngine({ onSample: () => {} })

    engine.sync([{ id: 't1', host: 'host-a' }])
    await Promise.resolve()
    vi.mocked(probeLatency).mockClear()

    engine.sync([])
    await Promise.resolve()
    expect(probeLatency).not.toHaveBeenCalled()
  })

  it('skips a tick rather than overlapping probes for a target still in flight', async () => {
    // A target that's genuinely unreachable never resolves its own probe
    // quickly - without this guard, every tick fires a brand new overlapping
    // native ICMP call for it, and several such targets sharing one process
    // steady-state at 3-4 simultaneous in-flight calls each. Measured
    // directly: mixing 4 always-unreachable targets in with 10 reliable
    // ones collapsed EVERY target (not just the dead ones) to ~99% loss on
    // the shared native ICMP handle - restoring this guard fixed it.
    vi.useFakeTimers()
    let resolveProbe: (() => void) | null = null
    vi.mocked(probeLatency).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = () => resolve(10)
        })
    )

    engine = new NetworkEngine({ onSample: () => {}, pingIntervalMs: 100 })
    engine.sync([{ id: 't1', host: 'host-a' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(probeLatency).toHaveBeenCalledTimes(1)

    // Several more ticks elapse while the first probe is still unresolved -
    // none of them should dispatch a second overlapping call.
    await vi.advanceTimersByTimeAsync(350)
    expect(probeLatency).toHaveBeenCalledTimes(1)

    resolveProbe?.()
    await vi.advanceTimersByTimeAsync(0)
    // Now that the first call has resolved, the next tick is free to fire.
    await vi.advanceTimersByTimeAsync(100)
    expect(probeLatency).toHaveBeenCalledTimes(2)
  })

  it('backs off retrying a target once it fails several ticks in a row', async () => {
    // The in-flight guard above only stops a target from overlapping its OWN
    // calls - it doesn't stop a target that's genuinely down from firing a
    // brand new (always-failing) probe on every single tick forever. Measured
    // directly: a 14-target mix with several always-unreachable targets among
    // them started clean but progressively collapsed EVERY target - including
    // ones with nothing to do with the dead ones - to 50-100% loss over about
    // two minutes, apparently from how much never-succeeding traffic the dead
    // targets keep feeding whatever's shared across every native call in the
    // process. Backing off a target's own retry rate once it's been failing
    // for a few consecutive samples fixed it in the same test.
    vi.useFakeTimers()
    vi.mocked(probeLatency).mockResolvedValue(null)

    engine = new NetworkEngine({ onSample: () => {}, pingIntervalMs: 100 })
    engine.sync([{ id: 't1', host: 'dead-host' }])

    // First few ticks still fire at the normal cadence - backoff hasn't
    // kicked in yet below the failure threshold.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(probeLatency).toHaveBeenCalledTimes(3)

    // The 3rd consecutive failure crosses the threshold - the very next tick
    // is skipped rather than firing another probe immediately.
    await vi.advanceTimersByTimeAsync(100)
    expect(probeLatency).toHaveBeenCalledTimes(3)

    // It does still retry eventually, just less often than every tick.
    await vi.advanceTimersByTimeAsync(300)
    expect(probeLatency).toHaveBeenCalledTimes(4)
  })

  it('resets the backoff as soon as a backed-off target replies again', async () => {
    vi.useFakeTimers()
    vi.mocked(probeLatency).mockResolvedValue(null)

    engine = new NetworkEngine({ onSample: () => {}, pingIntervalMs: 100 })
    engine.sync([{ id: 't1', host: 'flaky-host' }])

    // Fail enough consecutive times to enter backoff.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(probeLatency).toHaveBeenCalledTimes(3)

    // The next probe (after the backoff delay) succeeds.
    vi.mocked(probeLatency).mockResolvedValue(10)
    await vi.advanceTimersByTimeAsync(200)
    expect(probeLatency).toHaveBeenCalledTimes(4)

    // Back to the normal per-tick cadence immediately - no lingering backoff.
    await vi.advanceTimersByTimeAsync(100)
    expect(probeLatency).toHaveBeenCalledTimes(5)
  })
})
