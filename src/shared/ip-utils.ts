/**
 * True for a private (RFC 1918/4193), link-local, loopback, or CGNAT address
 * - none of these ever have a public hosting/ISP org to look up, so callers
 * use this to skip the lookup (main process) or pick a more honest fallback
 * label than a raw hop number (renderer).
 */
export function isPrivateOrReservedIp(address: string): boolean {
  return (
    /^10\./.test(address) ||
    /^127\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^169\.254\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ||
    address === '::1' ||
    address.startsWith('fe80:') ||
    address.startsWith('fc') ||
    address.startsWith('fd')
  )
}
