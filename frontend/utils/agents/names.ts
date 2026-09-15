import { generateMnemonic } from 'bip39'

/** Generate a short, human-readable name without exposing naming in setup flows. */
const generateResourceName = () =>
  generateMnemonic(128).trim().split(/\s+/).slice(0, 3).join('-')

export const generateAgentName = generateResourceName
export const generateConnectionName = generateResourceName
