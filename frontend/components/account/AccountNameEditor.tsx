'use client'

import { useState } from 'react'
import { useApolloClient, useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaCheck, FaPen, FaTimes } from 'react-icons/fa'
import { useUser } from '@/contexts/userContext'
import { Button } from '../common/Button'
import { UpdateAccountProfileOp } from '@/graphql/mutations/account/updateAccountProfile.gql'

export default function AccountNameEditor() {
  const { user, refetch } = useUser()
  const apollo = useApolloClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  // The save handler owns the error toast — suppress the global one.
  const [updateProfile] = useMutation(UpdateAccountProfileOp, {
    context: { suppressGlobalErrorToast: true },
  })

  const startEditing = () => {
    setName(user?.fullName === user?.email ? '' : user?.fullName || '')
    setEditing(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateProfile({ variables: { fullName: name.trim() } })
      await refetch()
      // Cached org member lists still hold the old name — clear the store
      // so they refetch on next view.
      await apollo.resetStore().catch(() => {})
      toast.success('Display name updated.')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update your name.')
    } finally {
      setSaving(false)
    }
  }

  if (editing)
    return (
      <form onSubmit={handleSave} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={128}
          autoFocus
          className="custom bg-zinc-100 dark:bg-zinc-800 rounded-md text-sm ph-no-capture"
        />
        <Button
          variant="primary"
          type="submit"
          icon={FaCheck}
          isLoading={saving}
          disabled={saving || !name.trim()}
        />
        <Button
          variant="secondary"
          type="button"
          icon={FaTimes}
          onClick={() => setEditing(false)}
          disabled={saving}
        />
      </form>
    )

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-medium truncate">{user?.fullName}</span>
      <button
        type="button"
        onClick={startEditing}
        title="Edit display name"
        className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease shrink-0"
      >
        <FaPen className="text-xs" />
      </button>
    </div>
  )
}
