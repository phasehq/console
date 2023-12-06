import {
  ApiEnvironmentSyncEventStatusChoices,
  ApiEnvironmentSyncStatusChoices,
} from '@/apollo/graphql'
import { FaCheckCircle, FaHourglassEnd, FaTimesCircle } from 'react-icons/fa'
import Spinner from '../common/Spinner'

export const SyncStatusIndicator = (props: {
  status: ApiEnvironmentSyncStatusChoices | ApiEnvironmentSyncEventStatusChoices
  showLabel?: boolean
}) => {
  const { status, showLabel } = props

  if (status === ApiEnvironmentSyncStatusChoices.Completed) {
    return (
      <div className="flex items-center gap-2">
        <FaCheckCircle className="text-emerald-500 shrink-0" />
        {showLabel && 'Synced'}
      </div>
    )
  } else if (status === ApiEnvironmentSyncStatusChoices.Failed) {
    return (
      <div className="flex items-center gap-2">
        <FaTimesCircle className="text-red-500 shrink-0" />
        {showLabel && 'Failed'}
      </div>
    )
  } else if (status === ApiEnvironmentSyncStatusChoices.TimedOut) {
    return (
      <div className="flex items-center gap-2">
        <FaHourglassEnd className="text-amber-500 shrink-0" />
        {showLabel && 'Timed out'}
      </div>
    )
  } else
    return (
      <div className="flex items-center gap-2">
        <Spinner size="xs" color="amber" />
        {showLabel && 'Syncing'}
      </div>
    )
}
