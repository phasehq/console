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
