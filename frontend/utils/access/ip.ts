export const isValidCidr = (ip: string) => {
  try {
    if (!ip) return false
    const [addr, prefix] = ip.split('/')
    if (prefix && (isNaN(+prefix) || +prefix < 0 || +prefix > 32)) return false
    const octets = addr.split('.')
    if (octets.length !== 4) return false
    return octets.every((o) => {
      const n = +o
      return !isNaN(n) && n >= 0 && n <= 255
    })
  } catch {
    return false
  }
}
