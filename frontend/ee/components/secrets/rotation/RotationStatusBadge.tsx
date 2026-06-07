import clsx from 'clsx'
import { FaArrowsRotate, FaCircleCheck, FaCircleExclamation, FaPause } from 'react-icons/fa6'

export type RotationHealth = 'healthy' | 'degraded' | 'failed' | string

interface RotationStatusBadgeProps {
  health?: RotationHealth | null
  isActive?: boolean | null
  size?: 'sm' | 'md'
  showLabel?: boolean
}

const STYLES = {
  healthy: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/20',
    label: 'Rotating',
    Icon: FaArrowsRotate,
  },
  degraded: {
    color: 'text-amber-500',
    bg: 'bg-amber-400/10',
    ring: 'ring-amber-400/20',
    label: 'Degraded',
    Icon: FaCircleExclamation,
  },
  failed: {
    color: 'text-red-500',
    bg: 'bg-red-400/10',
    ring: 'ring-red-400/20',
    label: 'Failed',
    Icon: FaCircleExclamation,
  },
  paused: {
    color: 'text-neutral-500',
    bg: 'bg-neutral-400/10',
    ring: 'ring-neutral-400/20',
    label: 'Paused',
    Icon: FaPause,
  },
  ok: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/20',
    label: 'OK',
    Icon: FaCircleCheck,
  },
}

export const RotationStatusBadge = ({
  health,
  isActive,
  size = 'sm',
  showLabel = true,
}: RotationStatusBadgeProps) => {
  const key = isActive === false ? 'paused' : (health as keyof typeof STYLES) ?? 'healthy'
  const style = STYLES[key] ?? STYLES.healthy
  const Icon = style.Icon

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap',
        style.color,
        showLabel && [
          'rounded-full ring-1 ring-inset',
          style.bg,
          style.ring,
          size === 'sm' ? 'text-2xs px-1.5 py-0.5' : 'text-xs px-2 py-1',
        ]
      )}
      title={`Rotation status: ${style.label}`}
    >
      <Icon
        className={
          showLabel
            ? size === 'sm'
              ? 'text-[10px]'
              : 'text-xs'
            : size === 'sm'
              ? 'text-sm'
              : 'text-base'
        }
      />
      {showLabel && <span>{style.label}</span>}
    </span>
  )
}
