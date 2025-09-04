import { DynamicSecretType, EnvironmentType, KeyMap } from '@/apollo/graphql'
import clsx from 'clsx'
import { FaBolt } from 'react-icons/fa6'
import { CreateLeaseDialog } from './CreateLeaseDialog'
import { ManageLeasesDialog } from './ManageLeasesDialog'
import { DeleteDynamicSecretDialog } from './DeleteDynamicSecretDialog'
import { UpdateDynamicSecretDialog } from '@/app/[team]/integrations/dynamic-secrets/_components/UpdateDynamicSecretDialog'
import { randomString } from '@/utils/copy'

export const DynamicSecretRow = ({
  secret,
  environment,
}: {
  secret: DynamicSecretType
  environment: EnvironmentType
}) => {
  const keyMap: KeyMap[] = (secret.keyMap as KeyMap[]) ?? []

  const KEY_BASE_STYLE = 'w-full font-mono custom bg-transparent transition ease p-1 ph-no-capture'

  return (
    <div className="p-2 ring-1 ring-inset ring-emerald-400/20 flex w-full rounded-lg group">
      <div className="w-1/3">
        <div className="text-2xs text-emerald-500 flex items-center gap-1 bg-emerald-400/10 rounded-full w-min whitespace-nowrap px-1">
          <FaBolt /> {secret.name}
        </div>
        <div className={clsx('flex flex-col gap-2 group relative pl-8 ')}>
          {keyMap.map((key) => (
            <div key={key.id} className={KEY_BASE_STYLE}>
              {String(key.keyName).toUpperCase()}
            </div>
          ))}
        </div>
      </div>
      <div className="w-2/3 px-6 relative group">
        <div className="absolute flex flex-col gap-2 pointer-events-none group-hover:opacity-0 transition ease">
          {keyMap.map((k) => (
            <input
              className="custom outline-none font-mono bg-transparent"
              key={`value-${k.keyName}`}
              readOnly
              type="password"
              value={randomString()}
            />
          ))}
        </div>

        <div className="flex h-full items-center gap-4  opacity-0 group-hover:opacity-100 transition ease">
          <CreateLeaseDialog secret={secret} />
          <ManageLeasesDialog secret={secret} />
          <UpdateDynamicSecretDialog secret={secret} environment={environment} />
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition ease flex items-center">
        <DeleteDynamicSecretDialog secret={secret} />
      </div>
    </div>
  )
}
