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
})
