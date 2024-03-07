import { SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { CreateSharedSecret } from '@/graphql/mutations/environments/shareSecret.gql'
import { encryptAsymmetric, randomKeyPair } from '@/utils/crypto'
import { useMutation } from '@apollo/client'
import { Fragment, useState } from 'react'
import { FaCircle, FaDotCircle, FaShare, FaShareAlt } from 'react-icons/fa'
import _sodium from 'libsodium-wrappers-sumo'
import { getUnixTimeStampinFuture } from '@/utils/time'
import { RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import CopyButton from '@/components/common/CopyButton'

interface ExpiryOptionT {
  name: string
  getExpiry: () => number | null
}

const lockboxExpiryOptions: ExpiryOptionT[] = [
  {
    name: 'Never',
    getExpiry: () => null,
  },
  {
    name: '7 days',
    getExpiry: () => getUnixTimeStampinFuture(7),
  },
  {
    name: '30 days',
    getExpiry: () => getUnixTimeStampinFuture(30),
  },
  {
    name: '60 days',
    getExpiry: () => getUnixTimeStampinFuture(60),
  },
  {
    name: '90 days',
    getExpiry: () => getUnixTimeStampinFuture(90),
  },
]

const compareExpiryOptions = (a: ExpiryOptionT, b: ExpiryOptionT) => {
  return a.getExpiry() === b.getExpiry()
}

const humanReadableExpiry = (expiryOption: ExpiryOptionT) =>
  expiryOption.getExpiry() === null
    ? 'This link will never expire.'
    : `This link will expire on ${new Date(expiryOption.getExpiry()!).toLocaleDateString()}.`

export const ShareSecretDialog = (props: { secret: SecretType }) => {
  const [createLockbox, { error, loading }] = useMutation(CreateSharedSecret)

  const [secretData, setSecretData] = useState({ text: props.secret.value })
  const [allowedViews, setAllowedViews] = useState(1)
  const [expiry, setExpiry] = useState<ExpiryOptionT>(lockboxExpiryOptions[0])

  const [box, setBox] = useState<{ lockboxId: string; key: string } | null>(null)

  const handleTextChange = (value: string) => {
    setSecretData({ text: value })
  }

  const handleCreateLockbox = () => {
    return new Promise<{ lockboxId: string; key: string }>((resolve, reject) => {
      setTimeout(async () => {
        await _sodium.ready
        const sodium = _sodium

        const { publicKey, privateKey } = await randomKeyPair()
        const ciphertext = await encryptAsymmetric(secretData.text, sodium.to_hex(publicKey))

        const mutationPayload = {
          data: JSON.stringify({ text: ciphertext }),
          expiry: expiry.getExpiry(),
          allowedViews,
        }

        const { data } = await createLockbox({ variables: { input: mutationPayload } })

        if (data.createLockbox.lockbox) {
          resolve({ lockboxId: data.createLockbox.lockbox.id, key: sodium.to_hex(privateKey) })
        } else {
          reject(error?.message || 'Something went wrong. Please try again')
        }
      })
    })
  }

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()

    toast
      .promise(handleCreateLockbox, {
        pending: 'Encrypting secret...',
        success: 'Shareable link created',
      })
      .then((box: { lockboxId: string; key: string }) => setBox(box))
  }

  const hostname = `${window.location.protocol}//${window.location.host}`
  const link = box ? `${hostname}/lockbox/${box.lockboxId}#${box.key}` : ''

  return (
    <GenericDialog
      title={box ? 'Share this link' : 'Share secret'}
      buttonVariant="outline"
      buttonContent={
        <span className="py-1">
          <FaShareAlt />
        </span>
      }
      onClose={() => {}}
    >
      {box ? (
        <div className="space-y-6">
          <div>
            <div className="text-neutral-500">{humanReadableExpiry(expiry)}</div>
          </div>

          <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-sm text-emerald-800 dark:text-emerald-300">
            <pre className="text-xs">{link}</pre>
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-800"></div>
            <div className="absolute right-1 top-2.5 ">
              <CopyButton code={link} />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-neutral-500">
            Create a link to share this secret with zero-trust encryption
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2 w-full">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="secret">
                Secret
              </label>
              <textarea
                rows={5}
                value={secretData.text}
                className="w-full"
                onChange={(e) => handleTextChange(e.target.value)}
              ></textarea>
            </div>

            <div>
              <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
                <RadioGroup.Label as={Fragment}>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Expiry</label>
                </RadioGroup.Label>
                <div className="flex flex-wrap items-center gap-2">
                  {lockboxExpiryOptions.map((option) => (
                    <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                      {({ active, checked }) => (
                        <div
                          className={clsx(
                            'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800  rounded-full',
                            active && 'border-zinc-700',
                            checked && 'bg-zinc-700'
                          )}
                        >
                          {checked ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                          {option.name}
                        </div>
                      )}
                    </RadioGroup.Option>
                  ))}
                </div>
              </RadioGroup>
              <span className="text-sm text-neutral-500">{humanReadableExpiry(expiry)}</span>
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" isLoading={loading}>
                <FaShare /> Share
              </Button>
            </div>
          </form>
        </div>
      )}
    </GenericDialog>
  )
}
