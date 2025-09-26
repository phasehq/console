import { useState, forwardRef, useImperativeHandle, useRef, useEffect } from 'react'

import { FaPlus } from 'react-icons/fa'
import { AwsIamIdentityForm } from './providers/aws/iam'
import { ProviderCards } from './ProviderCards'
import GenericDialog from '../common/GenericDialog'
import { set } from 'lodash'

interface AddNewIdentityDialogProps {
  organisationId: string
  onSuccess: () => void
  preSelectedProvider?: string | null
}

export const AddNewIdentityDialog = forwardRef<
  { openModal: () => void; closeModal: () => void },
  AddNewIdentityDialogProps
>(({ organisationId, onSuccess, preSelectedProvider = null }, ref) => {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(preSelectedProvider)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  useEffect(() => {
    if (preSelectedProvider) setSelectedProvider(preSelectedProvider)
  }, [preSelectedProvider])

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId)
  }

  const handleSuccess = () => {
    setSelectedProvider(null)
    dialogRef.current?.closeModal()
    onSuccess()
  }

  const handleBack = () => {
    setSelectedProvider(null)
  }

  const handleDialogClose = () => {
    setSelectedProvider(null)
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Add Identity Provider"
      size="lg"
      onClose={handleDialogClose}
      dialogTitle={
        <div>
          <h3>Add Identity Provider</h3>
        </div>
      }
    >
      <div className="space-y-8 pt-">
        <div className="text-neutral-500 text-sm">
          {selectedProvider
            ? 'Configure your identity provider'
            : 'Select a provider below to create a new identity.'}
        </div>
        {!selectedProvider ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <ProviderCards onProviderSelect={handleProviderSelect} />
          </div>
        ) : selectedProvider === 'aws_iam' ? (
          <AwsIamIdentityForm
            organisationId={organisationId}
            onSuccess={handleSuccess}
            onBack={handleBack}
          />
        ) : null}
      </div>
    </GenericDialog>
  )
})

AddNewIdentityDialog.displayName = 'AddNewIdentityDialog'
