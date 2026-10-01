import { FaCopy } from 'react-icons/fa'
import CopyButton from '@/components/common/CopyButton'
import { LogField } from '@/app/[team]/access/scim/_components/shared'
import { parseJwks } from '@/utils/syncing/gcp'

const shorten = (value: string) =>
  value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value

/** The public key (JWKS) Phase signs with for this credential, to compare
 * with the key uploaded to the Workload Identity provider. */
export const GCPWorkloadIdentityDetails = (props: { credentials: Record<string, string> }) => {
  const jwks = props.credentials['jwks']
  if (!jwks) return null

  const keys = parseJwks(jwks)
  let json = jwks
  try {
    json = JSON.stringify(JSON.parse(jwks), null, 2)
  } catch {}

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-neutral-500 text-xs">PUBLIC KEY (JWKS)</label>
        <CopyButton value={json} buttonVariant="ghost" title="Copy the JWKS as JSON">
          <div className="flex items-center gap-1">
            <FaCopy className="h-3.5 w-3.5" />
            <span>Copy JSON</span>
          </div>
        </CopyButton>
      </div>
      <div className="rounded-md ring-1 ring-inset ring-neutral-500/40 p-3 space-y-3 text-zinc-900 dark:text-zinc-100">
        {keys ? (
          keys.map((key) => (
            <div key={key.keyId || key.modulus} className="space-y-1.5">
              <LogField label="Key ID">{key.keyId}</LogField>
              <LogField label="Algorithm">{key.algorithm}</LogField>
              <LogField label="Key type">
                {key.keyType}
                {key.bits ? `, ${key.bits}-bit` : ''}
              </LogField>
              <LogField label="Use">{key.use === 'sig' ? 'Signature' : key.use}</LogField>
              {key.exponent !== null && <LogField label="Exponent">{key.exponent}</LogField>}
              {key.modulus && <LogField label="Modulus">{shorten(key.modulus)}</LogField>}
            </div>
          ))
        ) : (
          <pre className="text-2xs font-mono whitespace-pre-wrap break-all text-neutral-500">
            {jwks}
          </pre>
        )}
      </div>
    </div>
  )
}
