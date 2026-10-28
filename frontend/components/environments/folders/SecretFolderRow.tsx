import { SecretFolderType } from '@/apollo/graphql'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FaFolder, FaKey } from 'react-icons/fa'
import { DeleteFolderConfirmDialog } from './DeleteDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, memo } from 'react'
import { userHasPermission } from '@/utils/access/permissions'

const SecretFolderRowComponent = (props: { folder: SecretFolderType; handleDelete: Function }) => {
  const { folder, handleDelete } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanDeleteFolders = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'delete',
    true
  )

  const pathname = usePathname()

  return (
    <div className="flex flex-row w-full gap-2 group relative z-0">
      <Link
        href={`${pathname}/${folder.name}`}
        className="px-2 py-2 flex min-w-0 items-center justify-between w-full gap-4 sm:gap-8 text-2xs 2xl:text-xs group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition ease rounded-sm group"
      >
        <div className="flex min-w-0 items-center gap-3">
          <FaFolder className="shrink-0 text-amber-500" />
          <span className="truncate">{folder.name}</span>
        </div>

        {/* Below sm the icons label the counts, so the row keeps room for the name */}
        <div className="grid grid-cols-2 gap-3 sm:gap-6 text-neutral-500 text-2xs w-28 sm:w-72 shrink-0">
          <span className="flex items-center gap-2">
            <FaFolder />
            <span>
              {folder.folderCount}
              <span className="hidden sm:inline"> folder{folder.folderCount !== 1 && 's'}</span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            <FaKey />
            <span>
              {folder.secretCount}
              <span className="hidden sm:inline"> secret{folder.secretCount !== 1 && 's'}</span>
            </span>
          </span>
        </div>
      </Link>
      {userCanDeleteFolders && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity ease flex items-center px-2">
          <DeleteFolderConfirmDialog folder={folder} onDelete={handleDelete} />
        </div>
      )}
    </div>
  )
}

// Only re-render if folder fields or handler reference change.
const areEqual = (
  prev: { folder: SecretFolderType; handleDelete: Function },
  next: { folder: SecretFolderType; handleDelete: Function }
) => {
  const pf = prev.folder
  const nf = next.folder
  return (
    pf.id === nf.id &&
    pf.name === nf.name &&
    pf.folderCount === nf.folderCount &&
    pf.secretCount === nf.secretCount &&
    prev.handleDelete === next.handleDelete
  )
}

export const SecretFolderRow = memo(SecretFolderRowComponent, areEqual)
