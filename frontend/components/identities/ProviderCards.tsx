import { Card } from '../common/Card'
import { ProviderIcon } from '../syncing/ProviderIcon'
import { FaArrowRight } from 'react-icons/fa'
import { useQuery } from '@apollo/client'
import GetIdentityProviders from '@/graphql/queries/identities/getIdentityProviders.gql'

interface IdentityProvider {
  id: string
  name: string
  description: string
  iconId: string
  supported: boolean
}

const ProviderCard = ({
  provider,
  onClick,
}: {
  provider: IdentityProvider
  onClick: () => void
}) => {
  return (
    <Card>
      <button className="w-full" onClick={onClick}>
        <div className="flex flex-auto gap-4 cursor-pointer">
          <div className="text-4xl">
            <ProviderIcon providerId={provider.iconId} />
          </div>
          <div className="flex flex-col gap-6 text-left">
            <div>
              <div className="text-black dark:text-white text-lg font-semibold">
                {provider.name}
              </div>
              <div className="text-neutral-500 text-sm">{provider.description}</div>
            </div>
            <div className="text-emerald-500 flex items-center gap-1 font-medium text-sm">
              Create <FaArrowRight />
            </div>
          </div>
        </div>
      </button>
    </Card>
  )
}

interface ProviderCardsProps {
  onProviderSelect: (providerId: string) => void
}

export const ProviderCards = ({ onProviderSelect }: ProviderCardsProps) => {
  const { data } = useQuery(GetIdentityProviders)
  const providers: IdentityProvider[] = data?.identityProviders ?? []

  return (
    <>
      {providers.map((provider) => (
        <div key={provider.id}>
          <ProviderCard provider={provider} onClick={() => onProviderSelect(provider.id)} />
        </div>
      ))}
    </>
  )
}
