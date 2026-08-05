import {
  ApiLogStreamDeliveryEventStatusChoices,
  ApiLogStreamHealthChoices,
  LogStreamType,
} from '@/apollo/graphql'
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaForward,
  FaPauseCircle,
  FaTimesCircle,
} from 'react-icons/fa'
import { streamIsDelayed } from './utils'

export const LogStreamStatusIndicator = (props: { stream: LogStreamType }) => {
  const { stream } = props

  if (!stream.isActive) {
    const pausedTitle =
      stream.pausedReason === 'auth_error'
        ? 'Paused: the destination rejected the configured credentials'
        : stream.pausedReason === 'credentials_missing'
          ? 'Paused: the third-party credentials for this stream were deleted'
          : 'Paused'
    return (
      <div className="flex items-center gap-1.5 text-amber-500" title={pausedTitle}>
        <FaPauseCircle /> Paused
      </div>
    )
  }

  if (streamIsDelayed(stream))
    return (
      <div
        className="flex items-center gap-1.5 text-amber-500"
        title="New events are queued but deliveries are running late"
      >
        <FaExclamationCircle /> Delayed
      </div>
    )

  if (stream.health === ApiLogStreamHealthChoices.Degraded)
    return (
      <div
        className="flex items-center gap-1.5 text-red-500"
        title={stream.lastFailureReason || 'Some deliveries are failing'}
      >
        <FaTimesCircle /> Degraded
      </div>
    )

  return (
    <div className="flex items-center gap-1.5 text-emerald-500" title="Shipping normally">
      <FaCheckCircle /> Healthy
    </div>
  )
}

export const DeliveryStatusIndicator = (props: {
  status: ApiLogStreamDeliveryEventStatusChoices | string
  showLabel?: boolean
}) => {
  const { status, showLabel } = props

  const statusValue = String(status).toLowerCase()

  if (statusValue === 'completed')
    return (
      <div className="flex items-center gap-1.5 text-emerald-500">
        <FaCheckCircle /> {showLabel && 'Completed'}
      </div>
    )

  if (statusValue === 'failed')
    return (
      <div className="flex items-center gap-1.5 text-red-500">
        <FaTimesCircle /> {showLabel && 'Failed'}
      </div>
    )

  return (
    <div className="flex items-center gap-1.5 text-amber-500">
      <FaForward /> {showLabel && 'Skipped'}
    </div>
  )
}
