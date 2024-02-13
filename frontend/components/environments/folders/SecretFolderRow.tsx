import { SecretFolderType } from '@/apollo/graphql'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FaFolder } from 'react-icons/fa'
import { DeleteFolderConfirmDialog } from './DeleteDialog'

export const SecretFolderRow = (props: { folder: SecretFolderType; handleDelete: Function }) => {
  const { folder, handleDelete } = props

  const pathname = usePathname()

  return (
    <div className="flex flex-row w-full gap-2 group relative z-0 py-1">
      <Link
        href={`${pathname}/${folder.name}`}
        className="py-1 px-2 flex items-center justify-between w-full gap-4 text-lg group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition ease rounded-sm group"
      >
        <div className="flex items-center gap-3">
          <FaFolder className="text-emerald-500" /> {folder.name}
        </div>

        <div className="flex items-center gap-4 text-neutral-500 text-sm">
          <span>{folder.folderCount} folders</span>
          <span>{folder.secretCount} secrets</span>
        </div>
      </Link>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity ease flex items-center">
        <DeleteFolderConfirmDialog folder={folder} onDelete={handleDelete} />
      </div>
    </div>
  )
}
