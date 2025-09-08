import { DynamicSecretLeaseType, KeyMap } from '@/apollo/graphql'
import CopyButton from '@/components/common/CopyButton'
import { Input } from '@/components/common/Input'

export const AWSCredentials = ({
  lease,
  keyMap,
}: {
  lease: DynamicSecretLeaseType
  keyMap: KeyMap[]
}) => {
  if (!lease.credentials) return <></>

  const credentialKeyName = (credentialId: string) =>
    keyMap.find((key) => key.id === credentialId)?.keyName ?? credentialId

  return (
    <>
      <div className="relative">
        <Input
          type="password"
          value={lease.credentials.accessKeyId || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('access_key_id')}
          labelClassName="font-mono"
        />
        <div className="absolute right-2 top-9">
          <CopyButton value={lease.credentials.accessKeyId || ''} />
        </div>
      </div>

      <div className="relative">
        <Input
          type="password"
          value={lease.credentials.secretAccessKey || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('secret_access_key')}
          labelClassName="font-mono"
        />
        <div className="absolute right-2 top-9">
          <CopyButton value={lease.credentials.secretAccessKey || ''} />
        </div>
      </div>

      <div className="relative">
        <Input
          type="password"
          value={lease.credentials.username || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('username')}
          labelClassName="font-mono"
        />
        <div className="absolute right-2 top-9">
          <CopyButton value={lease.credentials.username || ''} />
        </div>
      </div>
    </>
  )
}
