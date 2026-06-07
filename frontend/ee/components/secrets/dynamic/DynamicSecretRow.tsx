import { DynamicSecretType, EnvironmentType, KeyMap } from '@/apollo/graphql'
import clsx from 'clsx'
import { FaBolt } from 'react-icons/fa6'
import { CreateLeaseDialog } from './CreateLeaseDialog'
import { ManageLeasesDialog } from './ManageLeasesDialog'
import { DeleteDynamicSecretDialog } from './DeleteDynamicSecretDialog'
import { UpdateDynamicSecretDialog } from '@/ee/components/secrets/dynamic/UpdateDynamicSecretDialog'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'

interface DynamicSecretRowProps {
  secret: DynamicSecretType
  environment: EnvironmentType
  startIndex?: number
}

const KEY_BASE_STYLE =
  'w-full font-mono custom bg-transparent p-0.5 ph-no-capture rounded-lg text-2xs 2xl:text-sm text-zinc-900 dark:text-zinc-100'

export const DynamicSecretRow = ({
  secret,
  environment,
  startIndex = 0,
}: DynamicSecretRowProps) => {
  const keyMap: KeyMap[] = (secret.keyMap as KeyMap[]) ?? []

  return (
    <div
      className={clsx(
        'group/dynamic-group rounded-lg ring-1 ring-inset ring-neutral-500/20 bg-zinc-100/50 dark:bg-zinc-800/60',
        'my-0.5 overflow-hidden'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-between gap-2 px-2 py-1.5',
          'bg-zinc-200/70 dark:bg-zinc-900/60 border-b border-neutral-500/10'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-2xs font-medium whitespace-nowrap',
              'text-emerald-700 dark:text-emerald-300'
            )}
            title="Dynamic secret"
          >
            <FaBolt className="text-[10px]" />
            <span className="truncate max-w-[16rem]">{secret.name}</span>
          </span>
          {secret.provider && (
            <span className="text-xs leading-none" title={secret.provider}>
              <ProviderIcon providerId={secret.provider} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover/dynamic-group:opacity-100 focus-within:opacity-100 transition-opacity">
          <CreateLeaseDialog secret={secret} />
          <ManageLeasesDialog secret={secret} />
          <UpdateDynamicSecretDialog secret={secret} environment={environment} />
          <DeleteDynamicSecretDialog secret={secret} />
        </div>
      </div>

      <div className="flex flex-col gap-0">
        {keyMap.map((key, i) => (
          <div
            key={key.id}
            className="flex items-start gap-2 py-0.5 px-3 rounded-md"
          >
            <div className="text-neutral-500 font-mono text-2xs w-4 h-8 flex items-center">
              {startIndex + i + 1}
            </div>
            <div className="flex w-full gap-2 items-center">
              <div className="w-1/3">
                <div className={KEY_BASE_STYLE}>
                  {String(key.keyName).toUpperCase()}
                </div>
              </div>
              <div className="w-2/3">
                <MaskedTextarea
                  className={KEY_BASE_STYLE}
                  value={`value-${key.keyName}`}
                  expanded={false}
                  isRevealed={false}
                  readOnly
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
