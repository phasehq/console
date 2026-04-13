'use client'

import { useState, useContext } from 'react'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { toast } from 'react-toastify'
import { useSession } from '@/contexts/userContext'
import { useUser } from '@/contexts/userContext'
import { organisationContext } from '@/contexts/organisationContext'
import {
  deviceVaultKey,
  passwordAuthHash,
  encryptAccountKeyring,
  encryptAccountRecovery,
  decryptAccountKeyring,
  decryptAccountRecovery,
} from '@/utils/crypto'
import { setDevicePassword } from '@/utils/localStorage'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'

export function ChangePasswordSection() {
  const { user } = useUser()
  const { data: session } = useSession()
  const { activeOrganisation, organisations } = useContext(organisationContext)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)

  // Only show for password users
  if (!user || user.authMethod !== 'password') return null

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPw !== confirmPw) {
      toast.error("New passwords don't match")
      return
    }

    if (newPw.length < 16) {
      toast.error('Password must be at least 16 characters')
      return
    }

    const email = session?.user?.email
    if (!email || !organisations) return

    setLoading(true)
    try {
      const oldMasterKey = await deviceVaultKey(currentPw, email)
      const oldAuthHash = await passwordAuthHash(oldMasterKey)
      const newMasterKey = await deviceVaultKey(newPw, email)
      const newAuthHash = await passwordAuthHash(newMasterKey)

      // Re-encrypt keyring + recovery for EVERY org the user belongs to
      const orgKeys: { orgId: string; wrappedKeyring: string; wrappedRecovery: string }[] = []

      for (const org of organisations) {
        if (!org.keyring) continue

        const keyring = await decryptAccountKeyring(org.keyring, oldMasterKey)
        const newWrappedKeyring = await encryptAccountKeyring(keyring, newMasterKey)

        let newWrappedRecovery = ''
        if (org.recovery) {
          const mnemonic = await decryptAccountRecovery(org.recovery, oldMasterKey)
          newWrappedRecovery = await encryptAccountRecovery(mnemonic, newMasterKey)
        }

        orgKeys.push({
          orgId: org.id,
          wrappedKeyring: newWrappedKeyring,
          wrappedRecovery: newWrappedRecovery,
        })
      }

      await axios.post(
        UrlUtils.makeUrl(
          process.env.NEXT_PUBLIC_BACKEND_API_BASE!,
          'auth',
          'password',
          'change'
        ),
        {
          currentAuthHash: oldAuthHash,
          newAuthHash: newAuthHash,
          orgKeys,
        },
        { withCredentials: true }
      )

      // Update stored device password for all orgs
      for (const org of organisations) {
        if (org.memberId) {
          setDevicePassword(org.memberId, newPw)
        }
      }

      toast.success('Password changed successfully')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.error(err.response.data.error)
      } else {
        toast.error('Failed to change password. Check your current password and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
      <div className="text-base font-medium">Change password</div>
      <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
        <Input
          id="current-password"
          label="Current password"
          value={currentPw}
          setValue={setCurrentPw}
          secret
          required
          minLength={16}
        />
        <Input
          id="new-password"
          label="New password"
          value={newPw}
          setValue={setNewPw}
          secret
          required
          minLength={16}
        />
        <Input
          id="confirm-password"
          label="Confirm new password"
          value={confirmPw}
          setValue={setConfirmPw}
          secret
          required
          minLength={16}
        />
        <Button type="submit" variant="primary" isLoading={loading} disabled={loading}>
          Change password
        </Button>
      </form>
    </div>
  )
}
