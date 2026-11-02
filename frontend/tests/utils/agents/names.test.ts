import { generateAgentName, generateConnectionName } from '@/utils/agents/names'

jest.mock('bip39', () => ({
  generateMnemonic: jest.fn(
    () => 'ability able about above absent absorb abstract absurd abuse access accident account'
  ),
}))

describe('generateAgentName', () => {
  test('uses three readable BIP-39 words', () => {
    const name = generateAgentName()

    expect(name).toBe('ability-able-about')
    expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
    expect(name.length).toBeLessThanOrEqual(64)
  })

  test('uses the same readable format for Connections', () => {
    expect(generateConnectionName()).toBe('ability-able-about')
  })
})
