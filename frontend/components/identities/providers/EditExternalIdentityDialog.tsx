import { IdentityType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { AwsIamIdentityForm } from './aws/iam'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useRef } from 'react'
import { FaCog, FaEdit } from 'react-icons/fa'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'

export const EditExternalIdentityDialog = ({ identity }: { identity: IdentityType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const dialogTitle = () => {
    switch (identity.provider) {
      case 'aws_iam':
        return (
          <div className="flex items-center gap-3">
            <div className="text-2xl">
              <ProviderIcon providerId="aws" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-black dark:text-white">
                Edit AWS IAM Identity
              </h3>
              <div className="text-neutral-500 text-sm">
                Configure trusted entities and token settings
              </div>
            </div>
          </div>
        )
      default:
        return <>Edit Identity</>
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit AWS IAM Identity"
      dialogTitle={dialogTitle()}
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaCog /> Configure
        </>
      }
    >
      {identity.provider === 'aws_iam' && (
        <AwsIamIdentityForm
          organisationId={organisation?.id || ''}
          identity={identity}
          onSuccess={() => dialogRef.current?.closeModal()}
        />
      )}
    </GenericDialog>
  )
}
