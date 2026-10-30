import type { ComponentType } from 'react'
import clsx from 'clsx'
import { BsLaptopFill, BsPersonVcardFill } from 'react-icons/bs'
import { FaEdge, FaWindows } from 'react-icons/fa'
import { GoPasskeyFill } from 'react-icons/go'
import {
  Si1Password,
  SiApple,
  SiBitwarden,
  SiDashlane,
  SiEnpass,
  SiGoogle,
  SiGooglechrome,
  SiKeepassxc,
  SiKeeper,
  SiLastpass,
  SiProton,
  SiSamsung,
  SiYubico,
  SiZoho,
} from 'react-icons/si'

// What a passkey is (the backend's `kind`): a passkey synced by a password
// manager or platform keychain, a hardware security key, or a passkey bound
// to one computer or phone.
export type PasskeyKind = 'synced' | 'security_key' | 'device'

type Icon = ComponentType<{ className?: string }>

/** GitHub's passkey glyph (a person and a key), with a USB security key. */
export const SecurityKeyIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M9.496 2a5.25 5.25 0 0 0-2.519 9.857A9.006 9.006 0 0 0 .5 20.228a.751.751 0 0 0 .728.772h5.257c3.338.001 6.677.002 10.015 0a.5.5 0 0 0 .5-.5v-4.669a.95.95 0 0 0-.171-.551 9.02 9.02 0 0 0-4.814-3.423A5.25 5.25 0 0 0 9.496 2Z" />
    <path
      fillRule="evenodd"
      d="M19.75 3h2.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-2.5a1.5 1.5 0 0 1-1.5-1.5v-10a1.5 1.5 0 0 1 1.5-1.5ZM21 6.25a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
    />
    <path d="M19.5 15.5h3v5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5Z" />
  </svg>
)

type KindInfo = { label: string; icon: Icon }

export const PASSKEY_KINDS: Record<PasskeyKind, KindInfo> = {
  synced: { label: 'Synced passkey', icon: BsPersonVcardFill },
  security_key: { label: 'Hardware security key', icon: SecurityKeyIcon },
  device: { label: 'Device-bound passkey', icon: BsLaptopFill },
}

export const passkeyKindInfo = (kind: string): KindInfo =>
  PASSKEY_KINDS[kind as PasskeyKind] ?? { label: 'Passkey', icon: GoPasskeyFill }

/**
 * A vendor mark from public/assets/passkeys, drawn in the text colour like
 * the Simple Icons marks (the PNG is a mask over currentColor). Taken from
 * the FIDO Metadata Service icons, for vendors Simple Icons doesn't cover.
 */
const vendorMark = (slug: string): Icon => {
  const url = `url(/assets/passkeys/${slug}.png)`
  const VendorMark = ({ className }: { className?: string }) => (
    <span
      aria-hidden="true"
      className={clsx('inline-block bg-current', className)}
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  )
  VendorMark.displayName = `VendorMark(${slug})`
  return VendorMark
}

// Brand marks for the authenticators the backend names from their AAGUID
// (api/utils/passkey_authenticators.py), so only ever a provider we
// recognised, never a name the client chose.
const BRAND_ICONS: [RegExp, Icon][] = [
  [/^Bitwarden$/, SiBitwarden],
  [/^1Password$/, Si1Password],
  [/^Google Password Manager$|^Google Titan/, SiGoogle],
  [/^Chrome on Mac$|^Chromium Browser$/, SiGooglechrome],
  [/^iCloud Keychain|^Apple Passwords$/, SiApple],
  [/^Windows Hello$/, FaWindows],
  [/^Microsoft Password Manager$|^Edge on Mac$/, FaEdge],
  [/^KeePassXC$/, SiKeepassxc],
  [/^Proton Pass$/, SiProton],
  [/^Dashlane$/, SiDashlane],
  [/^LastPass$/, SiLastpass],
  [/^Samsung Pass$/, SiSamsung],
  [/^Enpass$/, SiEnpass],
  [/^Keeper$/, SiKeeper],
  [/^Zoho Vault$/, SiZoho],
  [/^YubiKey|by Yubico/, SiYubico],
  [/^Hyper FIDO/, vendorMark('hyperfido')],
  [/^Nitrokey/, vendorMark('nitrokey')],
  [/^Ledger/, vendorMark('ledger')],
]

/** The provider's mark when we know it, else the icon for the kind. */
export const passkeyIcon = (kind: string, authenticatorName: string | null): Icon =>
  (authenticatorName && BRAND_ICONS.find(([pattern]) => pattern.test(authenticatorName))?.[1]) ||
  passkeyKindInfo(kind).icon

const TRANSPORT_LABELS: Record<string, string> = {
  usb: 'USB',
  nfc: 'NFC',
  ble: 'Bluetooth',
  'smart-card': 'Smart card',
  hybrid: 'Phone (QR code)',
  internal: 'Built in',
}

export const transportLabels = (transports: string[]) =>
  transports.map((t) => TRANSPORT_LABELS[t] ?? t)
