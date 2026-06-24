import { IdentityType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { AwsIamIdentityForm } from './aws/iam'
import { AzureEntraIdentityForm } from './azure/entra'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useRef } from 'react'
import { FaCog, FaEdit } from 'react-icons/fa'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'

export const EditExternalIdentityDialog = ({ identity }: { identity: IdentityType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const providerLabel = () => {
    switch (identity.provider) {
      case 'aws_iam':
        return { icon: 'aws', title: 'Edit AWS IAM Identity' }
      case 'azure_entra':
        return { icon: 'azure', title: 'Edit Azure Identity' }
      default:
        return { icon: '', title: 'Edit Identity' }
    }
  }

  const { icon, title } = providerLabel()

  const dialogTitle = () => {
    if (!icon) return <>{title}</>
    return (
      <div className="flex items-center gap-3">
        <div className="text-xl">
          <ProviderIcon providerId={icon} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-black dark:text-white">{title}</h3>
          <div className="text-neutral-500 text-sm">
            Configure trusted entities and token settings
          </div>
        </div>
      </div>
    )
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={title}
      dialogTitle={dialogTitle()}
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaCog /> Configure
        </>
      }
    >
      <div className="pt-4">
        {identity.provider === 'aws_iam' && (
          <AwsIamIdentityForm
            organisationId={organisation?.id || ''}
            identity={identity}
            onSuccess={() => dialogRef.current?.closeModal()}
          />
        )}
        {identity.provider === 'azure_entra' && (
          <AzureEntraIdentityForm
            organisationId={organisation?.id || ''}
            identity={identity}
            onSuccess={() => dialogRef.current?.closeModal()}
          />
        )}
      </div>
    </GenericDialog>
  )
}
