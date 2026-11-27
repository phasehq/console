import * as ipaddr from 'ipaddr.js'

const parseCidrPrefix = (cidr: string): { addr: string; prefix: number } | null => {
  const parts = cidr.split('/')
  if (parts.length !== 2) return null

  const [addr, prefixStr] = parts
  if (!addr || !/^\d+$/.test(prefixStr)) return null

  return { addr, prefix: Number(prefixStr) }
}

export const isValidIp = (ip: string): boolean => {
  try {
    if (!ip || ip.includes('/')) return false
    ipaddr.parse(ip)
    return true
  } catch {
    return false
  }
}

export const isValidCidr = (cidr: string): boolean => {
  try {
    const parsedCidr = parseCidrPrefix(cidr)
    if (!parsedCidr) return false

    const parsed = ipaddr.parse(parsedCidr.addr)

    if (parsed.kind() === 'ipv4') {
      return parsedCidr.prefix >= 0 && parsedCidr.prefix <= 32
    } else if (parsed.kind() === 'ipv6') {
      return parsedCidr.prefix >= 0 && parsedCidr.prefix <= 128
    } else {
      return false
    }
  } catch {
    return false
  }
}

/**
 * Checks if a client IP address is allowed based on a list of IPs and CIDR ranges.
 *
 * @param ipList - An array of IP addresses or CIDR ranges (e.g., "192.168.1.1", "10.0.0.0/24").
 * @param clientIp - The IP address of the client to check.
 * @returns `true` if the client IP matches any IP or CIDR range in the list, or if the list is empty; otherwise, `false`.
 */
export const isClientIpAllowed = (ipList: string[], clientIp: string): boolean => {
  try {
    if (ipList.length === 0) {
      return true
    }

    const addr = ipaddr.parse(clientIp)

    return ipList.some((entry) => {
      try {
        if (entry.includes('/')) {
          const parsedEntry = parseCidrPrefix(entry)
          if (!parsedEntry) return false
          const cidr = ipaddr.parse(parsedEntry.addr)
          const range = cidr.match(addr, parsedEntry.prefix)
          return range
        } else {
          return addr.toNormalizedString() === ipaddr.parse(entry).toNormalizedString()
        }
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}
