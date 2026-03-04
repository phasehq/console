import { DynamicSecretType, EnvironmentType, KeyMap } from '@/apollo/graphql'
import clsx from 'clsx'
import { FaBolt } from 'react-icons/fa6'
import { CreateLeaseDialog } from './CreateLeaseDialog'
import { ManageLeasesDialog } from './ManageLeasesDialog'
import { DeleteDynamicSecretDialog } from './DeleteDynamicSecretDialog'
import { UpdateDynamicSecretDialog } from '@/ee/components/secrets/dynamic/UpdateDynamicSecretDialog'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'

export const DynamicSecretRow = ({
  secret,
  environment,
}: {
  secret: DynamicSecretType
  environment: EnvironmentType
}) => {
  const keyMap: KeyMap[] = (secret.keyMap as KeyMap[]) ?? []

  const KEY_BASE_STYLE =
    'w-full font-mono custom bg-transparent transition ease p-0.5 ph-no-capture rounded-lg text-2xs 2xl:text-sm'

  return (
    <div className="flex w-full gap-2 rounded-lg group">
      <div className="w-1/3">
        <div className="text-2xs text-emerald-500 flex items-center gap-1 bg-emerald-400/10 rounded-full w-min whitespace-nowrap px-1">
          <FaBolt /> {secret.name}
        </div>
        <div className={clsx('flex flex-col gap-0.5 group relative pl-10')}>
          {keyMap.map((key) => (
            <div key={key.id} className={KEY_BASE_STYLE}>
              {String(key.keyName).toUpperCase()}
            </div>
          ))}
        </div>
      </div>
      <div className="w-2/3 pl-4 pr-2 relative group">
        <div className="absolute flex flex-col gap-1 pointer-events-none group-hover:opacity-0 transition ease pl-2 pt-1.5">
          {keyMap.map((k) => (
            <MaskedTextarea
              className={clsx(KEY_BASE_STYLE)}
              value={`value-${k.keyName}`}
              expanded={false}
              isRevealed={false}
              key={`value-${k.keyName}`}
            />
          ))}
        </div>

        <div className="flex h-full items-center justify-between gap-2 opacity-0 group-hover:opacity-100 transition ease">
          <CreateLeaseDialog secret={secret} />
          <div className="flex items-center gap-2">
            <ManageLeasesDialog secret={secret} />
            <UpdateDynamicSecretDialog secret={secret} environment={environment} />
          </div>
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition ease flex items-center">
        <DeleteDynamicSecretDialog secret={secret} />
      </div>
    </div>
  )
}
