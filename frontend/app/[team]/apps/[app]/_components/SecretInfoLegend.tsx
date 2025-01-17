import { FaCheckCircle, FaCircle, FaTimesCircle } from 'react-icons/fa'

export const SecretInfoLegend = () => (
  <div className="flex items-center justify-end gap-4 p-4 text-neutral-500 text-xs whitespace-nowrap">
    <div className="flex items-center gap-1">
      <FaCheckCircle className="text-emerald-500 shrink-0" /> Secret is present
    </div>
    <div className="flex items-center gap-1">
      <FaCheckCircle className="text-amber-500 shrink-0" /> Secret is the same as Production
    </div>
    <div className="flex items-center gap-1">
      <FaCircle className="text-neutral-500 shrink-0" /> Secret is blank
    </div>
    <div className="flex items-center gap-1">
      <FaTimesCircle className="text-red-500 shrink-0" /> Secret is missing
    </div>
  </div>
)
