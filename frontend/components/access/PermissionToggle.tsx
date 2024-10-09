import { ToggleSwitch } from '../common/ToggleSwitch'

export const PermissionToggle = ({
  isActive,
  onToggle,
  disabled,
}: {
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
}) => {
  return (
    <td className="text-center">
      <ToggleSwitch value={isActive} onToggle={onToggle} disabled={disabled} />
    </td>
  )
}
