import {
  ApiEnvironmentSyncStatusChoices,
  EnvironmentSyncType,
  ProviderCredentialsType,
} from '@/apollo/graphql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import TriggerEnvSync from '@/graphql/mutations/syncing/triggerSync.gql'
import UpdateSyncAuth from '@/graphql/mutations/syncing/updateSyncAuthentication.gql'
import ToggleSync from '@/graphql/mutations/syncing/toggleSync.gql'
import { relativeTimeFromDates } from '@/utils/time'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { FaAngleDoubleRight, FaSync } from 'react-icons/fa'
import { Button } from '../common/Button'
import { DeleteSyncDialog } from './DeleteSyncDialog'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { useContext, useState } from 'react'
import { ProviderCredentialPicker } from './ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { toast } from 'react-toastify'
import { Switch } from '@headlessui/react'

export const SyncManagement = (props: { sync: EnvironmentSyncType }) => {
  const { sync } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [triggerSync] = useMutation(TriggerEnvSync)
  const [updateAuth] = useMutation(UpdateSyncAuth)
  const [toggleSyncActive] = useMutation(ToggleSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(sync.authentication!)
  const [isActive, setIsActive] = useState<boolean>(sync.isActive)

  const handleSync = async () => {
    await triggerSync({
      variables: { syncId: sync.id },
      refetchQueries: [
        {
          query: GetAppSyncStatus,
          variables: { appId: sync.environment.app.id },
        },
      ],
    })
  }

  const handleToggleSyncActive = async () => {
    setIsActive(!isActive)
    await toggleSyncActive({
      variables: { syncId: sync.id },
      refetchQueries: [
        {
          query: GetAppSyncStatus,
          variables: { appId: sync.environment.app.id },
        },
      ],
    })
    toast.success(`${isActive ? 'Paused' : 'Resumed'} syncing`, { autoClose: 2000 })
  }

  const handleUpdateAuth = async (cred: ProviderCredentialsType) => {
    setCredential(cred)

    if (cred !== null && cred.id !== credential?.id) {
      await updateAuth({
        variables: {
          syncId: sync.id,
          credentialId: cred.id,
        },
        refetchQueries: [
          {
            query: GetAppSyncStatus,
            variables: { appId: sync.environment.app.id },
          },
        ],
      })
      toast.success('Updated sync authentication')
    }
  }

  const isSyncing = sync.status === ApiEnvironmentSyncStatusChoices.InProgress

  return (
    <div className="py-4 space-y-4">
      <div className="grid grid-cols-2 w-full gap-4">
        <div className="text-neutral-500 uppercase tracking-widest text-sm">App</div>
        <div className="font-semibold">{sync.environment.app.name}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Environment</div>
        <div className="font-semibold">{sync.environment.name}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Service</div>
        <div className="font-semibold">{sync.serviceInfo?.name}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Project</div>
        <div className="font-semibold">
          {JSON.parse(sync.options)['project_name']}({JSON.parse(sync.options)['environment']})
        </div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Status</div>
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              sync.isActive ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
            )}
          ></div>
          {sync.isActive ? 'Active' : 'Paused'}

          <Switch
            id="toggle-sync"
            checked={isActive}
            onChange={handleToggleSyncActive}
            className={`${
              isActive
                ? 'bg-emerald-400/10 ring-emerald-400/20'
                : 'bg-neutral-500/40 ring-neutral-500/30'
            } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
          >
            <span className="sr-only">Active</span>
            <span
              className={`${
                isActive ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-black'
              } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
            ></span>
          </Switch>
        </div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Created</div>
        <div className="font-semibold">{relativeTimeFromDates(new Date(sync.createdAt))}</div>

        <div className="text-neutral-500 uppercase tracking-widest text-sm">Last sync</div>
        <div className="font-semibold flex items-center gap-2">
          <SyncStatusIndicator status={sync.status} showLabel />
          {sync.status !== ApiEnvironmentSyncStatusChoices.InProgress &&
            relativeTimeFromDates(new Date(sync.lastSync))}
        </div>

        <hr className="border-neutral-500/20 col-span-2" />

        <div className="col-span-2">
          <ProviderCredentialPicker
            credential={credential}
            setCredential={(cred) => handleUpdateAuth(cred)}
            orgId={organisation!.id}
          />
        </div>

        <div className="col-span-2 flex items-center gap-4 justify-end pt-4 border-t border-neutral-500/40">
          <Button variant="primary" onClick={handleSync} disabled={isSyncing}>
            <FaSync className={isSyncing ? 'animate-spin' : ''} /> Sync now
          </Button>
          <DeleteSyncDialog sync={sync} />
        </div>
      </div>
    </div>
  )
}
