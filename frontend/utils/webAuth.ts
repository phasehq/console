export interface WebAuthRequestParams {
  port: number
  publicKey: string
  requestedTokenName: string
  // The token lifetime requested by the CLI, in seconds. null = never expires.
  requestedTokenLifetime: number | null
}

/**
 * Parse a decoded webauth request payload sent by the Phase CLI.
 *
 * New CLIs send a base64-encoded JSON object:
 *   { port: number, publicKey: string, name: string, lifetime?: number }
 * where `lifetime` is the requested token lifetime in seconds (omitted, null or
 * non-positive = never expires).
 *
 * Older CLIs send a hyphen-joined string `port-pubKeyHex-patName`. The token name
 * itself can contain hyphens, so everything after the second hyphen is the name.
 *
 * @param {string} decoded - the base64-decoded payload string.
 * @returns {WebAuthRequestParams}
 */
export const parseWebAuthRequest = (decoded: string): WebAuthRequestParams => {
  try {
    const payload = JSON.parse(decoded)

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const lifetime =
        typeof payload.lifetime === 'number' && payload.lifetime > 0 ? payload.lifetime : null

      return {
        port: Number(payload.port),
        publicKey: typeof payload.publicKey === 'string' ? payload.publicKey : '',
        requestedTokenName: typeof payload.name === 'string' ? payload.name : '',
        requestedTokenLifetime: lifetime,
      }
    }
  } catch {
    // Not JSON - fall through to the legacy hyphen-joined format.
  }

  const delimiter = '-'
  const params = decoded.split(delimiter)

  return {
    port: Number(params[0]),
    publicKey: params[1] ?? '',
    requestedTokenName: params.slice(2).join(delimiter),
    requestedTokenLifetime: null,
  }
}

/**
 * Convert a requested token lifetime (in seconds) into an absolute Unix expiry
 * timestamp in milliseconds, as expected by `generateUserToken`/`CreateUserTokenMutation`.
 *
 * @param {number | null} lifetime - the requested lifetime in seconds, or null.
 * @returns {number | null} the absolute expiry timestamp in ms, or null for never-expiring.
 */
export const expiryFromLifetime = (lifetime: number | null): number | null =>
  lifetime ? Date.now() + lifetime * 1000 : null
