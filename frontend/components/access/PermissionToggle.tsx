import { ToggleSwitch } from '../common/ToggleSwitch'

export const PermissionToggle = ({
  isActive,
  onToggle,
  disabled,
  title,
}: {
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
  title?: string
}) => {
  return (
    <td className="text-center" title={title}>
      <ToggleSwitch value={isActive} onToggle={onToggle} disabled={disabled} />
    </td>
  )
}
