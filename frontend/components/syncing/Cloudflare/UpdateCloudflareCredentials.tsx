import { EnvironmentSyncType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useState } from 'react'
import { FaCheck, FaEdit, FaTimes } from 'react-icons/fa'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import UpdateCfPagesSyncCreds from '@/graphql/mutations/syncing/cloudflare/UpdateCfPagesSyncCreds.gql'
import { useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { toast } from 'react-toastify'

export const UpdateCloudflareCredentials = (props: { sync: EnvironmentSyncType }) => {
  const { sync } = props

  const credentials: { access_token: string; account_id: string } = JSON.parse(sync.credentials)

  const { data } = useQuery(GetServerKey)
  const [updateCredentials] = useMutation(UpdateCfPagesSyncCreds)

  const [accountId, setAccountId] = useState(credentials.account_id)
  const [accessToken, setAccessToken] = useState(credentials.access_token)
  const [allowEdit, setAllowEdit] = useState(false)

  const credentialsUpdated =
    accountId !== credentials.account_id || accessToken !== credentials.access_token

  const handleUpdateCredentials = async () => {
    const encryptedAccountId = await encryptAsymmetric(accountId, data.serverPublicKey)
    const encryptedAccessToken = await encryptAsymmetric(accessToken, data.serverPublicKey)

    await updateCredentials({
      variables: {
        syncId: sync.id,
        accountId: encryptedAccountId,
        accessToken: encryptedAccessToken,
      },
    })

    setAllowEdit(false)
    toast.success('Saved credentials')
  }

  return (
    <div className="space-y-4 w-full py-4 border-y border-neutral-500/40">
      <div className="text-black dark:text-white font-semibold text-xl flex justify-between">
        Credentials
        {allowEdit ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={!credentialsUpdated}
              variant="primary"
              onClick={handleUpdateCredentials}
            >
              <FaCheck /> Save
            </Button>{' '}
            <Button
              variant={credentialsUpdated ? 'danger' : 'secondary'}
              onClick={() => setAllowEdit(false)}
            >
              <FaTimes /> {credentialsUpdated ? 'Discard' : 'Cancel'}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAllowEdit(true)}>
            <FaEdit /> Edit
          </Button>
        )}
      </div>

      <div className="space-y-0 w-full text-sm">
        <label className="block text-gray-700 text-sm font-bold">Account ID</label>
        <input
          className="w-full"
          readOnly={!allowEdit}
          disabled={!allowEdit}
          type={allowEdit ? 'text' : 'password'}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        />
      </div>

      <div className="space-y-0 w-full text-sm">
        <label className="block text-gray-700 text-sm font-bold">Access Token</label>
        <input
          className="w-full"
          readOnly={!allowEdit}
          disabled={!allowEdit}
          type={allowEdit ? 'text' : 'password'}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </div>
    </div>
  )
}
