import { DynamicSecretType } from '@/apollo/graphql'
import { CreateLeaseDialog } from '@/components/environments/secrets/dynamic/CreateLeaseDialog'
import { DeleteDynamicSecretDialog } from '@/components/environments/secrets/dynamic/DeleteDynamicSecretDialog'
import { ManageDynamicSecretDialog } from '@/components/environments/secrets/dynamic/ManageDynamicSecretDialog'
import { FaBolt } from 'react-icons/fa6'
import { UpdateDynamicSecretDialog } from './UpdateDynamicSecretDialog'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'

export const DynamicSecret = ({ secret }: { secret: DynamicSecretType }) => {
  return (
    <div className="p-2 ring-1 ring-inset ring-neutral-400/20 flex flex-col gap-4 w-full rounded-lg group justify-between">
      <div className="">
        <div className="text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-1 px-1">
          <ProviderIcon providerId={secret.provider} /> {secret.name}
        </div>
        <div className="flex items-center gap-2">
          {secret.keyMap?.map((key) => (
            <span
              key={key!.keyName}
              className="font-mono text-neutral-500 text-xs bg-neutral-400/10 px-1 rounded-full"
            >
              {key!.keyName}
            </span>
          ))}
        </div>
      </div>
      <div className="relative group flex items-center justify-between w-full">
        <div className="flex h-full items-center justify-start gap-4 opacity-0 group-hover:opacity-100 transition ease">
          <CreateLeaseDialog secret={secret} />
          <ManageDynamicSecretDialog secret={secret} />
          <UpdateDynamicSecretDialog secret={secret} staticSecrets={[]} dynamicSecrets={[]} />
        </div>
        <div className="flex h-full items-center justify-end gap-4 opacity-0 group-hover:opacity-100 transition ease">
          <DeleteDynamicSecretDialog secret={secret} />
        </div>
      </div>
    </div>
  )
}
