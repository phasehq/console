import { BsPersonVcardFill } from 'react-icons/bs'
import { SiBitwarden, SiYubico } from 'react-icons/si'
import { passkeyIcon, SecurityKeyIcon } from '@/components/account/PasskeyKinds'

describe('passkeyIcon', () => {
  it('uses the brand mark of a recognised provider', () => {
    expect(passkeyIcon('synced', 'Bitwarden')).toBe(SiBitwarden)
    expect(passkeyIcon('security_key', 'YubiKey 5 Series with NFC')).toBe(SiYubico)
    expect(passkeyIcon('security_key', 'Security Key NFC by Yubico')).toBe(SiYubico)
  })

  it('uses a vendor mark for hardware keys Simple Icons lacks', () => {
    for (const name of ['Hyper FIDO Pro', 'Hyper FIDO Bio Security Key', 'Nitrokey 3 AM']) {
      const Icon = passkeyIcon('security_key', name) as { displayName?: string }
      expect(Icon.displayName).toMatch(/^VendorMark\(/)
    }
  })

  it('falls back to the kind when the provider is unknown or has no mark', () => {
    expect(passkeyIcon('security_key', null)).toBe(SecurityKeyIcon)
    expect(passkeyIcon('security_key', 'Feitian ePass FIDO2 Authenticator')).toBe(SecurityKeyIcon)
    expect(passkeyIcon('synced', 'NordPass')).toBe(BsPersonVcardFill)
    expect(passkeyIcon('synced', null)).toBe(BsPersonVcardFill)
  })
})
