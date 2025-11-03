import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetCustomerPortalLink } from '@/graphql/queries/billing/getStripePortalLink.gql'
import { useLazyQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaExternalLinkAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const StripeCustomerPortalLink = () => {
  const { activeOrganisation } = useContext(organisationContext)

  const [getPortalLink, { loading: portalLinkPending }] = useLazyQuery(GetCustomerPortalLink, {
    onCompleted: (data) => {
      const url = data?.stripeCustomerPortalUrl
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer')
      } else {
        toast.error('Could not get portal link.')
      }
    },
    onError: (error) => {
      toast.error('Failed to open billing portal.')
      console.error(error)
    },
    fetchPolicy: 'no-cache',
  })

  return (
    <Button
      variant="secondary"
      type="button"
      onClick={() => getPortalLink({ variables: { organisationId: activeOrganisation?.id } })}
      disabled={portalLinkPending}
      icon={FaExternalLinkAlt}
    >
      {portalLinkPending ? 'Loading…' : 'Manage billing'}
    </Button>
  )
}
