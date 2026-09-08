import { generateMnemonic } from 'bip39'

/** Generate a short, human-readable Agent name without exposing naming in the setup flow. */
export const generateAgentName = () =>
  generateMnemonic(128).trim().split(/\s+/).slice(0, 3).join('-')
