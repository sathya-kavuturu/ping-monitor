import koffi from 'koffi'

/**
 * Windows-only fast path for ICMP echo, modeled on how PingPlotter avoids
 * false "packet loss" bars: it never shells out to a subprocess per probe.
 * Instead it opens one raw ICMP handle for the process's whole lifetime and
 * sends echo requests directly through it (PingPlotter does this via a raw
 * socket; Windows also exposes the same underlying ICMP.SYS driver through
 * `iphlpapi.dll`'s IcmpSendEcho, which `ping.exe` itself is built on). That
 * removes child-process spawn/scheduling jitter from the timing budget
 * entirely, which was the leading suspect for the red "loss" bars showing up
 * more often than real packet loss should - see ping-probe.ts.
 *
 * The same call also accepts a custom TTL, which is what traceroute is at
 * the protocol level: a router whose TTL expires mid-transit replies with
 * an ICMP "time exceeded" from its own address instead of forwarding the
 * packet. traceroute-windows.ts uses this to build a full trace without
 * spawning `tracert` either - see probeHopNative below.
 *
 * Deliberately IPv4-only and Windows-only: raw ICMP sockets need
 * administrator privileges on Linux/macOS (unlike Windows, which allows this
 * specific API unprivileged), so those platforms keep using OS subprocesses
 * (`ping`/`traceroute`) instead of gaining an elevation requirement.
 */

const IP_SUCCESS = 0
const IP_TTL_EXPIRED_TRANSIT = 11013
const DEFAULT_REQUEST_DATA = Buffer.from('abcdefghijklmnopqrstuvwabcdefghi', 'ascii')
// ICMP_ECHO_REPLY is Address(4) + Status(4) + RoundTripTime(4) + ... - only
// these first three fields are ever read, but the OS wants room for the
// full struct plus the echoed request data plus slack for an error message.
const REPLY_BUFFER_SIZE = 64 + DEFAULT_REQUEST_DATA.length + 8

const IpOptionInformation = koffi.struct('IpOptionInformation', {
  Ttl: 'uint8',
  Tos: 'uint8',
  Flags: 'uint8',
  OptionsSize: 'uint8',
  OptionsData: 'void *'
})

type IcmpSendEchoFn = {
  async: (
    handle: bigint,
    destinationAddress: number,
    requestData: Buffer,
    requestSize: number,
    requestOptions: unknown,
    replyBuffer: Buffer,
    replySize: number,
    timeout: number,
    callback: (error: unknown, replyCount: number) => void
  ) => void
}

interface NativeIcmp {
  handle: bigint
  sendEcho: IcmpSendEchoFn
  closeHandle: (handle: bigint) => number
}

interface EchoResult {
  /** Number of ICMP_ECHO_REPLY structures the OS filled in (0 = no reply within timeout). */
  replyCount: number
  status: number
  roundTripTimeMs: number
  /** The address that actually replied - the destination on success, or an intermediate router on a TTL-expired reply. */
  address: string
}

let native: NativeIcmp | null = null
let initFailed = false

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (let i = 0; i < 4; i++) {
    const octet = Number(parts[i])
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    value |= octet << (i * 8)
  }
  return value >>> 0
}

function uint32ToIpv4(value: number): string {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff].join(
    '.'
  )
}

function initialize(): NativeIcmp | null {
  if (native) return native
  if (initFailed) return null

  try {
    const lib = koffi.load('iphlpapi.dll')
    const createFile = lib.func('__stdcall', 'IcmpCreateFile', 'void *', []) as () => bigint
    const closeHandle = lib.func('__stdcall', 'IcmpCloseHandle', 'int32', ['void *']) as (
      handle: bigint
    ) => number
    const sendEcho = lib.func('__stdcall', 'IcmpSendEcho', 'uint32', [
      'void *',
      'uint32',
      'void *',
      'uint16',
      'void *',
      'void *',
      'uint32',
      'uint32'
    ]) as unknown as IcmpSendEchoFn

    const handle = createFile()
    if (handle === 0n || handle === 0xffffffffffffffffn) {
      throw new Error('IcmpCreateFile returned an invalid handle')
    }

    native = { handle, sendEcho, closeHandle }
    return native
  } catch (error) {
    initFailed = true
    console.error('Native ICMP unavailable, falling back to OS ping/traceroute commands:', error)
    return null
  }
}

/**
 * Sends one ICMP echo to `destination` and resolves with its outcome.
 * `ttl` of `null` means "use the OS default" (a normal ping); a specific
 * number is how traceroute-windows.ts probes one hop.
 */
async function sendEcho(
  destination: number,
  ttl: number | null,
  timeoutMs: number
): Promise<EchoResult> {
  const icmp = initialize()
  if (!icmp) throw new Error('Native ICMP is not available')

  const replyBuffer = Buffer.alloc(REPLY_BUFFER_SIZE)
  const options =
    ttl === null
      ? null
      : koffi.as(
          { Ttl: ttl, Tos: 0, Flags: 0, OptionsSize: 0, OptionsData: null },
          'IpOptionInformation *'
        )

  const replyCount = await new Promise<number>((resolve, reject) => {
    icmp.sendEcho.async(
      icmp.handle,
      destination,
      DEFAULT_REQUEST_DATA,
      DEFAULT_REQUEST_DATA.length,
      options,
      replyBuffer,
      replyBuffer.length,
      timeoutMs,
      (error, result) => {
        if (error) reject(error)
        else resolve(result)
      }
    )
  })

  if (replyCount === 0) {
    return { replyCount: 0, status: -1, roundTripTimeMs: 0, address: '' }
  }

  return {
    replyCount,
    status: replyBuffer.readUInt32LE(4),
    roundTripTimeMs: replyBuffer.readUInt32LE(8),
    address: uint32ToIpv4(replyBuffer.readUInt32LE(0))
  }
}

/**
 * Sends one native ICMP echo to an IPv4 literal and resolves with the
 * round-trip time in ms, or `null` if lost/unreachable/timed out. Throws if
 * the native ICMP path itself is unavailable (caller should catch this and
 * fall back to the subprocess-based prober) - it never throws for an
 * ordinary lost packet, only for setup/environment failures.
 */
export async function probeLatencyNative(ipv4: string, timeoutMs: number): Promise<number | null> {
  const destination = ipv4ToUint32(ipv4)
  if (destination === null) throw new Error(`Not an IPv4 literal: ${ipv4}`)

  const result = await sendEcho(destination, null, timeoutMs)
  if (result.replyCount === 0 || result.status !== IP_SUCCESS) return null
  return result.roundTripTimeMs
}

export interface HopProbeResult {
  /** `null` means this hop never replied within the timeout. */
  address: string | null
  latencyMs: number | null
  /** True once a probe at this TTL reached the final destination. */
  reachedDestination: boolean
}

/**
 * Sends one ICMP echo with TTL set to `ttl` and interprets the result as one
 * traceroute hop: a "TTL expired in transit" reply means an intermediate
 * router answered from its own address; a success reply means the
 * destination itself was reached. Throws under the same conditions as
 * `probeLatencyNative` (caller falls back to the subprocess-based tracer).
 */
export async function probeHopNative(
  destinationIpv4: string,
  ttl: number,
  timeoutMs: number
): Promise<HopProbeResult> {
  const destination = ipv4ToUint32(destinationIpv4)
  if (destination === null) throw new Error(`Not an IPv4 literal: ${destinationIpv4}`)

  const result = await sendEcho(destination, ttl, timeoutMs)

  if (result.replyCount === 0) {
    return { address: null, latencyMs: null, reachedDestination: false }
  }
  if (result.status === IP_SUCCESS) {
    return { address: result.address, latencyMs: result.roundTripTimeMs, reachedDestination: true }
  }
  if (result.status === IP_TTL_EXPIRED_TRANSIT) {
    return { address: result.address, latencyMs: result.roundTripTimeMs, reachedDestination: false }
  }
  // Some other ICMP error (e.g. destination/net unreachable) - still surface
  // whichever address reported it rather than discarding the hop entirely.
  return {
    address: result.address || null,
    latencyMs: result.roundTripTimeMs,
    reachedDestination: false
  }
}

/**
 * Forces the (otherwise lazy) native ICMP setup to actually run if it hasn't
 * already, so this reports the real outcome rather than the merely-hopeful
 * "hasn't failed yet". `initialize()` is synchronous and memoized, so this
 * costs nothing after the first call - but skipping the eager check here
 * left a real gap: a caller (traceroute in particular, which fans out to 30
 * concurrent hop probes) could commit to the native path before any probe
 * had actually attempted setup, and if setup then failed, every one of
 * those probes would fail identically and get recorded as "hop never
 * replied" instead of falling back to the subprocess-based tracer.
 */
export function isNativeIcmpAvailable(): boolean {
  if (process.platform !== 'win32') return false
  return initialize() !== null
}

export function closeNativeIcmp(): void {
  if (native) {
    native.closeHandle(native.handle)
    native = null
  }
}
