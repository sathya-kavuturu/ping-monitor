import { describe, expect, it } from 'vitest'
import { parseUnixLine, parseWindowsLine } from '../src/main/network/traceroute'

describe('parseUnixLine', () => {
  it('parses a bare numeric address with latency', () => {
    expect(parseUnixLine(' 1  192.168.1.1  1.234 ms')).toEqual({
      hopNumber: 1,
      address: '192.168.1.1',
      hostname: null,
      latencyMs: 1.234
    })
  })

  it('parses the "hostname (address)" form', () => {
    expect(parseUnixLine('2  router.local (10.0.0.1)  4.5 ms')).toEqual({
      hopNumber: 2,
      address: '10.0.0.1',
      hostname: 'router.local',
      latencyMs: 4.5
    })
  })

  it('treats a run of stars as a silent hop', () => {
    expect(parseUnixLine('3  * * *')).toEqual({
      hopNumber: 3,
      address: null,
      hostname: null,
      latencyMs: null
    })
  })

  it('returns null for a line with no leading hop number', () => {
    expect(parseUnixLine('traceroute to example.com, 30 hops max')).toBeNull()
  })
})

describe('parseWindowsLine', () => {
  it('averages multiple "N ms" readings for a hop', () => {
    expect(parseWindowsLine('  1    <1 ms     1 ms     1 ms  10.0.0.1')).toEqual({
      hopNumber: 1,
      address: '10.0.0.1',
      hostname: null,
      latencyMs: 1
    })
  })

  it('treats a hop with no timing readings as silent', () => {
    expect(parseWindowsLine('  2     *        *        *     Request timed out.')).toEqual({
      hopNumber: 2,
      address: null,
      hostname: null,
      latencyMs: null
    })
  })

  it('returns null for a line with no leading hop number', () => {
    expect(parseWindowsLine('Tracing route to example.com over a maximum of 30 hops')).toBeNull()
  })
})
