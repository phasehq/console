import { SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { CreateSharedSecret } from '@/graphql/mutations/environments/shareSecret.gql'
import { useMutation } from '@apollo/client'
import { Fragment, useContext, useState } from 'react'
import { FaChevronDown, FaCircle, FaDotCircle, FaInfoCircle, FaShareAlt } from 'react-icons/fa'
import _sodium from 'libsodium-wrappers-sumo'
import { getUnixTimeStampinFuture } from '@/utils/time'
import { Listbox, RadioGroup, Tab } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import CopyButton from '@/components/common/CopyButton'
import { boxExpiryString, encryptBox, newBoxSeed } from '@/utils/lockbox'
import { getSecretPermalink } from '@/utils/secrets'
import { organisationContext } from '@/contexts/organisationContext'
import { getHostname } from '@/utils/appConfig'

interface ExpiryOptionT {
  name: string
  getExpiry: () => number | null
}

const lockboxExpiryOptions: ExpiryOptionT[] = [
  {
    name: '1 day',
    getExpiry: () => getUnixTimeStampinFuture(1),
  },
  {
    name: '2 days',
    getExpiry: () => getUnixTimeStampinFuture(2),
  },
  {
    name: '7 days',
    getExpiry: () => getUnixTimeStampinFuture(7),
  },
  {
    name: '1 month',
    getExpiry: () => getUnixTimeStampinFuture(30),
  },
  {
    name: '3 months',
    getExpiry: () => getUnixTimeStampinFuture(90),
  },
]

const lockboxAllowedViews = [1, 2, 3, 4, 5, 10, 25, 50, undefined]

const compareExpiryOptions = (a: ExpiryOptionT, b: ExpiryOptionT) => {
  return a.getExpiry() === b.getExpiry()
}

export const ShareSecretDialog = (props: { secret: SecretType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [createLockbox, { error, loading }] = useMutation(CreateSharedSecret)

  const [secretData, setSecretData] = useState({ text: props.secret.value })
  const [allowedViews, setAllowedViews] = useState<number | undefined>(1)
  const [expiry, setExpiry] = useState<ExpiryOptionT>(lockboxExpiryOptions[1])

  const [box, setBox] = useState<{ lockboxId: string; password: string } | null>(null)

  const permalink = organisation
    ? `${getHostname()}${getSecretPermalink(props.secret, organisation.name)}`
    : ''

  const reset = () => {
    setSecretData({ text: props.secret.value })
    setAllowedViews(1)
    setExpiry(lockboxExpiryOptions[1])
    setBox(null)
  }

  const handleTextChange = (value: string) => {
    setSecretData({ text: value })
  }

  const handleCreateLockbox = () => {
    return new Promise<{ lockboxId: string; password: string }>((resolve, reject) => {
      setTimeout(async () => {
        const seed = await newBoxSeed()

        const boxData = await encryptBox(JSON.stringify({ text: secretData.text }), seed)

        const mutationPayload = {
          data: boxData,
          expiry: expiry.getExpiry(),
          allowedViews,
        }

        const { data } = await createLockbox({ variables: { input: mutationPayload } })

        if (data.createLockbox.lockbox) {
          resolve({ lockboxId: data.createLockbox.lockbox.id, password: seed })
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
      .then((box: { lockboxId: string; password: string }) => setBox(box))
  }

  const hostname = `${window.location.protocol}//${window.location.host}`
  const link = box ? `${hostname}/lockbox/${box.lockboxId}#${box.password}` : ''

  return (
    <GenericDialog
      title={box ? 'Share this link' : `Share ${props.secret.key}`}
      buttonVariant="outline"
      buttonContent={
        <span className="py-1">
          <FaShareAlt />
        </span>
      }
      onClose={reset}
    >
      <div className="pt-4">
        <Tab.Group>
          <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
            <Tab as={Fragment}>
              {({ selected }) => (
                <div
                  className={clsx(
                    'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                    selected
                      ? 'border-emerald-500 font-semibold'
                      : ' border-transparent cursor-pointer'
                  )}
                >
                  Permalink
                </div>
              )}
            </Tab>
            <Tab as={Fragment}>
              {({ selected }) => (
                <div
                  className={clsx(
                    'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                    selected
                      ? 'border-emerald-500 font-semibold'
                      : ' border-transparent cursor-pointer'
                  )}
                >
                  Lockbox
                </div>
              )}
            </Tab>
          </Tab.List>
          <Tab.Panels>
            <Tab.Panel>
              <div className="space-y-4 pt-4">
                <div>
                  <div className="font-semibold text-black dark:text-white">Permalink</div>
                  <div className="text-neutral-500 text-sm">
                    Share the permalink to this secret to with your team on Phase. Only users with
                    access to this Environment will be able to open this link.
                  </div>
                </div>
                <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-sm text-emerald-800 dark:text-emerald-300">
                  <pre className="text-xs ph-no-capture">{permalink}</pre>
                  <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-300 dark:to-zinc-800"></div>
                  <div className="absolute right-1 top-2.5 ">
                    <CopyButton value={permalink} defaultHidden={false} />
                  </div>
                </div>
              </div>
            </Tab.Panel>
            <Tab.Panel>
              <div className="space-y-2 pt-4">
                <div>
                  <div className="font-semibold text-black dark:text-white">Share with Lockbox</div>
                  <div className="text-neutral-500 text-sm">
                    Create a link to share this secret via Phase Lockbox with Zero-Trust encryption.
                    Any user with the link will be able to view this secret.
                  </div>
                </div>

                {box ? (
                  <div className="space-y-6">
                    <div className="text-neutral-800 dark:text-neutral-100 flex items-center gap-2 text-sm font-medium">
                      <FaInfoCircle />{' '}
                      {boxExpiryString(expiry.getExpiry() || undefined, allowedViews)}
                    </div>

                    <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-sm text-emerald-800 dark:text-emerald-300">
                      <pre className="text-xs ph-no-capture">{link}</pre>
                      <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-300 dark:to-zinc-800"></div>
                      <div className="absolute right-1 top-2.5 ">
                        <CopyButton value={link} defaultHidden={false} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="space-y-0 w-full">
                      <label
                        className="block text-gray-700 text-sm font-bold mb-2"
                        htmlFor="secret"
                      >
                        Secret
                      </label>
                      <textarea
                        rows={5}
                        maxLength={10000}
                        value={secretData.text}
                        className="w-full ph-no-capture"
                        onChange={(e) => handleTextChange(e.target.value)}
                      ></textarea>
                    </div>

                    <div className="grid grid-cols-3 gap-8">
                      <div className="col-span-2">
                        <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
                          <RadioGroup.Label as={Fragment}>
                            <label className="block text-gray-700 text-sm font-bold mb-2">
                              Expiry
                            </label>
                          </RadioGroup.Label>
                          <div className="flex flex-wrap items-center gap-3">
                            {lockboxExpiryOptions.map((option) => (
                              <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                                {({ active, checked }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center gap-2 py-0.5 px-2 cursor-pointer bg-zinc-800 border border-zinc-800  rounded-full text-sm',
                                      active && 'border-zinc-700',
                                      checked && 'bg-zinc-700'
                                    )}
                                  >
                                    {checked ? (
                                      <FaDotCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}
                                    {option.name}
                                  </div>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="relative">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="secret"
                        >
                          Maximum allowed views
                        </label>
                        <Listbox value={allowedViews} onChange={setAllowedViews}>
                          {({ open }) => (
                            <>
                              <Listbox.Button as={Fragment} aria-required>
                                <div className="p-2 flex items-center justify-between  rounded-md h-10 cursor-pointer bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                                  {allowedViews || 'Unlimited'}
                                  <FaChevronDown
                                    className={clsx(
                                      'transition-transform ease duration-300 text-neutral-500',
                                      open ? 'rotate-180' : 'rotate-0'
                                    )}
                                  />
                                </div>
                              </Listbox.Button>
                              <Listbox.Options>
                                <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute mt-1 z-20 ring-1 ring-inset ring-neutral-500/40 w-full">
                                  {lockboxAllowedViews.map((num: number | undefined) => (
                                    <Listbox.Option key={num} value={num} as={Fragment}>
                                      {({ active, selected }) => (
                                        <div
                                          className={clsx(
                                            'flex items-center gap-2 p-2 cursor-pointer rounded-full text-sm text-zinc-900 dark:text-zinc-100',
                                            active && 'bg-zinc-400 dark:bg-zinc-700'
                                          )}
                                        >
                                          {num || 'Unlimited'} Views
                                        </div>
                                      )}
                                    </Listbox.Option>
                                  ))}
                                </div>
                              </Listbox.Options>
                            </>
                          )}
                        </Listbox>
                      </div>
                    </div>

                    <div className="text-sm text-neutral-500 flex items-center gap-2">
                      <FaInfoCircle />{' '}
                      {boxExpiryString(expiry.getExpiry() || undefined, allowedViews)}
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" variant="primary" isLoading={loading}>
                        <FaShareAlt /> Generate link
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </GenericDialog>
  )
}
