import clsx from 'clsx'
import { FaCircle } from 'react-icons/fa6'
import { FaCheckCircle, FaForward, FaTimesCircle } from 'react-icons/fa'
import {
  ApiLogStreamDeliveryEventStatusChoices,
  ApiLogStreamHealthChoices,
  LogStreamType,
} from '@/apollo/graphql'
import { streamIsDelayed } from './utils'

type StreamStatusKey = 'healthy' | 'delayed' | 'degraded' | 'paused'

// Tinted-pill palette shared with RotationStatusBadge: bg-*-400/10 fill +
// ring-*-400/20. Degraded (deliveries failing) is the red attention state;
// paused/delayed are amber.
const STYLES: Record<StreamStatusKey, { color: string; bg: string; ring: string; label: string }> = {
  healthy: { color: 'text-emerald-500', bg: 'bg-emerald-400/10', ring: 'ring-emerald-400/20', label: 'Healthy' },
  delayed: { color: 'text-amber-500', bg: 'bg-amber-400/10', ring: 'ring-amber-400/20', label: 'Delayed' },
  degraded: { color: 'text-red-500', bg: 'bg-red-400/10', ring: 'ring-red-400/20', label: 'Degraded' },
  paused: { color: 'text-amber-500', bg: 'bg-amber-400/10', ring: 'ring-amber-400/20', label: 'Paused' },
}

const resolveState = (stream: LogStreamType): StreamStatusKey => {
  if (!stream.isActive) return 'paused'
  if (streamIsDelayed(stream)) return 'delayed'
  if (stream.health === ApiLogStreamHealthChoices.Degraded) return 'degraded'
  return 'healthy'
}

const titleFor = (stream: LogStreamType, key: StreamStatusKey): string => {
  if (key === 'paused')
    return stream.pausedReason === 'auth_error'
      ? 'Paused: the destination rejected the configured credentials'
      : stream.pausedReason === 'credentials_missing'
        ? 'Paused: the third-party credentials for this stream were deleted'
        : 'Paused'
  if (key === 'delayed') return 'New events are queued but deliveries are running late'
  if (key === 'degraded') return stream.lastFailureReason || 'Some deliveries are failing'
  return 'Shipping normally'
}

export const LogStreamStatusIndicator = (props: {
  stream: LogStreamType
  size?: 'sm' | 'md'
}) => {
  const { stream, size = 'md' } = props
  const key = resolveState(stream)
  const style = STYLES[key]

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md ring-1 ring-inset',
        style.color,
        style.bg,
        style.ring,
        size === 'sm' ? 'text-2xs px-1.5 py-0.5' : 'text-xs px-2 py-1'
      )}
      title={titleFor(stream, key)}
    >
      <FaCircle className={size === 'sm' ? 'text-[7px]' : 'text-[9px]'} />
      <span>{style.label}</span>
    </span>
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
      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
        <FaCheckCircle /> {showLabel && 'Completed'}
      </div>
    )

  if (statusValue === 'failed')
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-500">
        <FaTimesCircle /> {showLabel && 'Failed'}
      </div>
    )

  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-500">
      <FaForward /> {showLabel && 'Skipped'}
    </div>
  )
}
