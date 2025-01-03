import { readFileSync } from 'fs'

/**
 * Retrieve secrets from either files or environment variables. Implements a "secrets provider" pattern 
 * commonly used in containerized applications.
 * 
 * 1. Check if {key}_FILE exists as an environment variable (e.g. PGSQL_PASSWORD_FILE)
 *    - If it exists, read the secret from that file location
 *    - This supports Docker/Kubernetes secrets (https://docs.docker.com/reference/compose-file/secrets)
 * 2. Fall back to checking if {key} exists as a regular environment variable
 * 
 * Example:
 *     // Using file-based secret:
 *     DATABASE_PASSWORD_FILE=/run/secrets/db_password
 *     getSecret('DATABASE_PASSWORD')  // reads from /run/secrets/db_password
 *     
 *     // Using environment variable:
 *     DATABASE_PASSWORD=ebeefa2b4634ab18b0280c96fce1adc5969dcad133cce440353b5ed1a7387f0a
 *     getSecret('DATABASE_PASSWORD')  // returns 'ebeefa2b4634ab18b0280c96fce1adc5969dcad133cce440353b5ed1a7387f0a'
 * 
 * @param key - Name of the secret to retrieve (e.g. 'DATABASE_PASSWORD')
 * @returns The secret value or empty string if not found
 */
export function getSecret(key: string): string {
    const debug = process.env.DEBUG ? process.env.DEBUG === 'True' : false
    
    const fileEnvKey = `${key}_FILE`
    const filePath = process.env[fileEnvKey]
    
    if (filePath) {
        try {
            const secret = readFileSync(filePath, 'utf8').trim()
            if (debug) {
                console.debug(`[secrets] Loaded secret '${key}' from file: ${filePath}`)
            }
            return secret
        } catch (e) {
            if (debug) {
                if (e instanceof Error) {
                    console.debug(`[secrets] Failed to read secret file for '${key}': ${e.message}`)
                }
            }
        }
    } else if (debug && filePath) {
        console.debug(`[secrets] File path specified for '${key}' but file not found: ${filePath}`)
    }
    
    const secret = process.env[key] || ''
    if (debug) {
        if (secret) {
            console.debug(`[secrets] Loaded secret '${key}' from environment variable`)
        } else {
            console.debug(`[secrets] Secret '${key}' not found in environment or file`)
        }
    }
    
    return secret
}
