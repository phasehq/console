import { Button } from '../../common/Button'
import clsx from 'clsx'
import { useState, useContext, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { FaHashtag } from 'react-icons/fa6'
import GenericDialog from '@/components/common/GenericDialog'

export const CommentDialog = (props: {
  secretId: string
  secretName: string
  comment: string
  handlePropertyChange: Function
}) => {
  const { secretId, secretName, comment, handlePropertyChange } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'update',
    true
  )

  const [commentValue, setCommentValue] = useState<string>(comment)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleClose = () => {
    handlePropertyChange(secretId, 'comment', commentValue)
    closeModal()
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title={comment || `Update ${secretName} comment`}
        dialogTitle={`Update ${secretName} comment`}
        buttonVariant="outline"
        buttonContent={
          <div className="py-1 2xl:py-0 flex items-center gap-1">
            <FaHashtag className={clsx(comment && 'text-emerald-500 ')} />{' '}
            <span className="hidden 2xl:block text-xs max-w-[24ch] truncate">
              {comment || 'Comment'}
            </span>
          </div>
        }
        buttonProps={{ tabIndex: -1 }}
      >
        <div className="py-4 ph-no-capture">
          <textarea
            rows={5}
            value={commentValue}
            className="w-full"
            onChange={(e) => setCommentValue(e.target.value)}
            disabled={!userCanUpdateSecrets}
          ></textarea>
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>
            Done
          </Button>
        </div>
      </GenericDialog>
    </>
  )
}
