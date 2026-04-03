'use client'

import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { FaExclamationTriangle, FaPlus, FaTrash } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { GetSCIMTokens } from '@/graphql/queries/scim/getSCIMTokens.gql'
import { CreateSCIMTokenOp } from '@/graphql/mutations/scim/createSCIMToken.gql'
import { DeleteSCIMTokenOp } from '@/graphql/mutations/scim/deleteSCIMToken.gql'
import { EXPIRY_OPTIONS } from './shared'

export function CreateSCIMTokenDialog({ organisationId }: { organisationId: string }) {
  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState<number | null>(90)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

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
      buttonContent={
        <>
          <FaPlus /> Create token
        </>
      }
      buttonVariant="primary"
      ref={dialogRef}
      onClose={handleClose}
    >
      <div className="pt-4 space-y-4">
        {createdToken ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 text-amber-500">
              <FaExclamationTriangle className="shrink-0 mt-0.5" />
              <p className="text-sm">Copy this token now. It will not be shown again.</p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 overflow-x-auto font-mono text-zinc-900 dark:text-zinc-100 break-all">
                {createdToken}
              </code>
              <CopyButton value={createdToken} />
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
              <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                Expiration
              </label>
              <div className="flex gap-2 flex-wrap">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setExpiryDays(opt.value)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-xs font-medium border transition',
                      expiryDays === opt.value
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500'
                        : 'border-zinc-500/20 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500/40'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
}

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
      buttonContent={<FaTrash />}
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
