import { DynamicSecretLeaseType, KeyMap } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { Input } from '@/components/common/Input'
import clsx from 'clsx'
import { useState } from 'react'
import { FaRegEyeSlash, FaRegEye } from 'react-icons/fa6'

export const AWSCredentials = ({
  lease,
  keyMap,
}: {
  lease: DynamicSecretLeaseType
  keyMap: KeyMap[]
}) => {
  const credentialKeyName = (credentialId: string) =>
    keyMap.find((key) => key.id === credentialId)?.keyName ?? credentialId

  const [reveal, setReveal] = useState({
    accessKeyId: false,
    secretAccessKey: false,
    username: false,
  })

  const toggle = (k: keyof typeof reveal) => setReveal((s) => ({ ...s, [k]: !s[k] }))

  if (!lease.credentials) return <></>

  return (
    <>
      <div className="relative">
        <Input
          value={lease.credentials.accessKeyId || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('access_key_id')}
          labelClassName="font-mono"
          className={clsx(
            'cursor-text ph-no-capture font-mono',
            reveal.accessKeyId ? 'text-security-none' : 'text-security-disc'
          )}
        />
        <div className="absolute right-2 top-9">
          <Button variant="outline" onClick={() => toggle('accessKeyId')}>
            {reveal.accessKeyId ? <FaRegEyeSlash /> : <FaRegEye />}
            {reveal.accessKeyId ? 'Hide' : 'Show'}
          </Button>
          <CopyButton value={lease.credentials.accessKeyId || ''} />
        </div>
      </div>

      <div className="relative">
        <Input
          value={lease.credentials.secretAccessKey || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('secret_access_key')}
          labelClassName="font-mono"
          className={clsx(
            'cursor-text ph-no-capture font-mono',
            reveal.secretAccessKey ? 'text-security-none' : 'text-security-disc'
          )}
        />
        <div className="absolute right-2 top-9">
          <Button variant="outline" onClick={() => toggle('secretAccessKey')}>
            {reveal.secretAccessKey ? <FaRegEyeSlash /> : <FaRegEye />}
            {reveal.secretAccessKey ? 'Hide' : 'Show'}
          </Button>
          <CopyButton value={lease.credentials.secretAccessKey || ''} />
        </div>
      </div>

      <div className="relative">
        <Input
          value={lease.credentials.username || ''}
          setValue={() => {}}
          readOnly
          label={credentialKeyName('username')}
          labelClassName="font-mono"
          className={clsx(
            'cursor-text ph-no-capture font-mono',
            reveal.username ? 'text-security-none' : 'text-security-disc'
          )}
        />
        <div className="absolute right-2 top-9">
          <Button variant="outline" onClick={() => toggle('username')}>
            {reveal.username ? <FaRegEyeSlash /> : <FaRegEye />}
            {reveal.username ? 'Hide' : 'Show'}
          </Button>
          <CopyButton value={lease.credentials.username || ''} />
        </div>
      </div>
    </>
  )
}
