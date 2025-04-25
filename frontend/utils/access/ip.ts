import * as ipaddr from 'ipaddr.js'

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
    if (!cidr) return false
    const [addr, prefixStr] = cidr.split('/')
    if (!addr || !prefixStr) return false

    const parsed = ipaddr.parse(addr)
    const prefix = parseInt(prefixStr, 10)

    if (parsed.kind() === 'ipv4') {
      return prefix >= 0 && prefix <= 32
    } else if (parsed.kind() === 'ipv6') {
      return prefix >= 0 && prefix <= 128
    } else {
      return false
    }
  } catch {
    return false
  }
}

export const isClientIpAllowed = (ipList: string[], clientIp: string) => {
  try {
    const addr = ipaddr.parse(clientIp)

    return ipList.some((entry) => {
      try {
        if (entry.includes('/')) {
          const [rangeIp, prefixLength] = entry.split('/')
          const cidr = ipaddr.parse(rangeIp)
          const range = cidr.match(addr, parseInt(prefixLength, 10))
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
