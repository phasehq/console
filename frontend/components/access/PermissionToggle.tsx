import { ToggleSwitch } from '../common/ToggleSwitch'

export const PermissionToggle = ({
  isActive,
  onToggle,
  disabled,
  label,
}: {
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
  label?: string
}) => {
  return (
    <td className="text-center">
      <ToggleSwitch value={isActive} onToggle={onToggle} disabled={disabled} label={label} />
    </td>
  )
}
