import clsx from 'clsx'
import { deletionStatus } from '@/components/common/PendingDeletionList'
import { GRID_CELL_BASE, GRID_DELETED_LANE, GridColumn } from './gridColumns'

/** A row's cell in the lane of an env that is scheduled for deletion: struck out, with nothing to read or edit */
export const DeletedEnvCell = ({ column }: { column: GridColumn }) => (
  <td
    className={clsx(GRID_CELL_BASE, GRID_DELETED_LANE)}
    title={column.deleted && `${column.env.name}: ${deletionStatus(column.deleted)}`}
  />
)
