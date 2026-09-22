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
})
