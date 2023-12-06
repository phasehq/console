import {
  ApiEnvironmentSyncEventStatusChoices,
  ApiEnvironmentSyncStatusChoices,
  EnvironmentSyncEventType,
} from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import { SyncStatusIndicator } from './SyncStatusIndicator'

export const SyncHistory = (props: { history: EnvironmentSyncEventType[] }) => {
  const { history } = props

  return (
    <div className="space-y-4 p-4">
      {history.map((syncEvent) => (
        <div key={syncEvent.id} className="grid grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <SyncStatusIndicator status={syncEvent.status} showLabel />
          </div>

          <div>Created {relativeTimeFromDates(new Date(syncEvent.createdAt))}</div>

          {syncEvent.status !== ApiEnvironmentSyncEventStatusChoices.InProgress && (
            <div>Completed {relativeTimeFromDates(new Date(syncEvent.completedAt))}</div>
          )}
        </div>
      ))}
    </div>
  )
}
