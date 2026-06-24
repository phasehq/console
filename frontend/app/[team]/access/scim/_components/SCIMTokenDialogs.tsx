'use client'

import { forwardRef, Fragment, useImperativeHandle, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { RadioGroup } from '@headlessui/react'
import { FaCheckCircle, FaCircle, FaExclamationTriangle, FaTrash } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { GetSCIMTokens } from '@/graphql/queries/scim/getSCIMTokens.gql'
import { CreateSCIMTokenOp } from '@/graphql/mutations/scim/createSCIMToken.gql'
import { DeleteSCIMTokenOp } from '@/graphql/mutations/scim/deleteSCIMToken.gql'
import { humanReadableExpiry } from '@/utils/tokens'
import { getUnixTimeStampinFuture } from '@/utils/time'
import { EXPIRY_OPTIONS } from './shared'

export const CreateSCIMTokenDialog = forwardRef<
  { openModal: () => void; closeModal: () => void },
  { organisationId: string }
>(({ organisationId }, ref) => {
  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState<number | null>(90)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [createToken, { loading }] = useMutation(CreateSCIMTokenOp, {
    refetchQueries: [{ query: GetSCIMTokens, variables: { organisationId } }],
  })

  const handleCreate = async () => {
    if (!name.trim()) return

    try {
      const { data } = await createToken({
        variables: {
          organisationId,
          name: name.trim(),
          expiryDays,
        },
      })
      setCreatedToken(data.createScimToken.token)
      toast.success('SCIM token created')
    } catch (err: any) {
      toast.error(err.message || 'Failed to create SCIM token')
    }
  }

  const handleClose = () => {
    setName('')
    setExpiryDays(90)
    setCreatedToken(null)
  }

  return (
    <GenericDialog
      title="Create SCIM token"
      ref={dialogRef}
      onClose={handleClose}
      isStatic={!!createdToken}
    >
      <div className="pt-4 space-y-4">
        {createdToken ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 text-amber-500">
              <FaExclamationTriangle className="shrink-0 mt-0.5" />
              <p className="text-sm">Copy this token now. It will not be shown again.</p>
            </div>
            <div className="bg-zinc-300/50 dark:bg-zinc-800/50 shadow-inner p-3 rounded-lg group relative">
              <div className="w-full flex items-center justify-between pb-3">
                <span className="uppercase text-xs tracking-widest text-gray-500">
                  SCIM token
                </span>
                <CopyButton value={createdToken} />
              </div>
              <code className="text-xs break-all text-emerald-500 ph-no-capture font-mono">
                {createdToken}
              </code>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => dialogRef.current?.closeModal()}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                Token name
              </label>
              <Input
                value={name}
                setValue={setName}
                placeholder="e.g. Azure Entra ID"
                required
              />
            </div>
            <div>
              <RadioGroup value={expiryDays} onChange={setExpiryDays}>
                <RadioGroup.Label as={Fragment}>
                  <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                    Expiration
                  </label>
                </RadioGroup.Label>
                <div className="flex flex-wrap items-center gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <RadioGroup.Option key={opt.label} value={opt.value} as={Fragment}>
                      {({ checked }) => (
                        <div>
                          <Button type="button" variant={checked ? 'primary' : 'secondary'}>
                            {checked ? (
                              <FaCheckCircle className="text-emerald-500" />
                            ) : (
                              <FaCircle />
                            )}
                            {opt.label}
                          </Button>
                        </div>
                      )}
                    </RadioGroup.Option>
                  ))}
                </div>
              </RadioGroup>
              <span className="text-xs text-neutral-500">
                {humanReadableExpiry({
                  name: '',
                  getExpiry: () =>
                    expiryDays === null ? null : getUnixTimeStampinFuture(expiryDays),
                })}
              </span>
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={handleCreate}
                isLoading={loading}
                disabled={!name.trim()}
              >
                Create
              </Button>
            </div>
          </>
        )}
      </div>
    </GenericDialog>
  )
})

CreateSCIMTokenDialog.displayName = 'CreateSCIMTokenDialog'

export function DeleteSCIMTokenDialog({
  tokenId,
  tokenName,
  organisationId,
}: {
  tokenId: string
  tokenName: string
  organisationId: string
}) {
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [deleteToken, { loading }] = useMutation(DeleteSCIMTokenOp, {
    refetchQueries: [{ query: GetSCIMTokens, variables: { organisationId } }],
  })

  const handleDelete = async () => {
    try {
      await deleteToken({ variables: { tokenId } })
      toast.success('SCIM token deleted')
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete SCIM token')
    }
  }

  return (
    <GenericDialog
      title={`Delete ${tokenName}`}
      buttonContent={
        <div className="py-1">
          <FaTrash />
        </div>
      }
      buttonVariant="danger"
      ref={dialogRef}
    >
      <div className="pt-4 space-y-4">
        <p className="text-sm text-neutral-500">
          Are you sure you want to delete the token{' '}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{tokenName}</span>? Any
          identity provider using this token will lose access.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={handleDelete} isLoading={loading}>
            Delete
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
