import { DynamicSecretLeaseType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { LeaseEventTimeline } from './LeaseTimeLine'
import { FaListCheck } from 'react-icons/fa6'

export const LeaseHistoryDialog = ({ lease }: { lease: DynamicSecretLeaseType }) => {
  return (
    <GenericDialog
      title="Lease History"
      buttonVariant="ghost"
      buttonContent={
        <div className="flex items-center gap-1 text-2xs">
          <FaListCheck /> History
        </div>
      }
    >
      <div className="space-y-4">
        <div className="text-neutral-500 text-sm">
          Chronological history of events related to this lease
        </div>
        <LeaseEventTimeline lease={lease} className="max-h-[80vh] overflow-y-auto" />
      </div>
    </GenericDialog>
  )
}
