import {
  ApiEnvironmentSyncEventStatusChoices,
  ApiEnvironmentSyncStatusChoices,
} from '@/apollo/graphql'
import { FaCheckCircle, FaHourglassEnd, FaMinusCircle, FaTimesCircle } from 'react-icons/fa'
import Spinner from '../common/Spinner'

export const SyncStatusIndicator = (props: {
  status: ApiEnvironmentSyncStatusChoices | ApiEnvironmentSyncEventStatusChoices
  showLabel?: boolean
}) => {
  const { status, showLabel } = props

  if (status === ApiEnvironmentSyncStatusChoices.Completed) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <FaCheckCircle className="text-emerald-500 shrink-0" />
        {showLabel && 'Synced'}
      </div>
    )
  } else if (status === ApiEnvironmentSyncStatusChoices.Failed) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <FaTimesCircle className="text-red-500 shrink-0" />
        {showLabel && 'Failed'}
      </div>
    )
  } else if (status === ApiEnvironmentSyncStatusChoices.TimedOut) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <FaHourglassEnd className="text-amber-500 shrink-0" />
        {showLabel && 'Timed out'}
      </div>
    )
  } else if (status === ApiEnvironmentSyncStatusChoices.Cancelled) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <FaMinusCircle className="text-neutral-500 shrink-0" />
        {showLabel && 'Skipped'}
      </div>
    )
  } else
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <Spinner size="xs" color="amber" />
        {showLabel && 'Syncing'}
      </div>
    )
}
