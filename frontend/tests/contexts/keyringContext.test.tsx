import React, { act, useContext } from 'react'
import { createRoot, Root } from 'react-dom/client'

jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: null }) }
})

import { OrganisationType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext, KeyringProvider } from '@/contexts/keyringContext'
import { OrganisationKeyring } from '@/utils/crypto'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const keyringFor = (orgId: string) =>
  ({
    publicKey: `${orgId}-pk`,
    privateKey: `${orgId}-sk`,
    symmetricKey: `${orgId}-sym`,
  }) as OrganisationKeyring

describe('KeyringProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let renders: Array<{ orgId: string | null; keyring: string | null }>
  let setKeyring: (keyring: OrganisationKeyring, organisationId: string) => void

  const Probe = ({ orgId }: { orgId: string | null }) => {
    const context = useContext(KeyringContext)
    setKeyring = context.setKeyring
    renders.push({ orgId, keyring: context.keyring?.publicKey ?? null })
    return null
  }

  const renderWithActiveOrg = async (orgId: string | null) => {
    await act(async () => {
      root.render(
        <organisationContext.Provider
          value={{
            activeOrganisation: orgId ? ({ id: orgId } as OrganisationType) : null,
            organisations: null,
            setActiveOrganisation: () => {},
            loading: false,
          }}
        >
          <KeyringProvider>
            <Probe orgId={orgId} />
          </KeyringProvider>
        </organisationContext.Provider>
      )
    })
  }

  const unlock = async (orgId: string) => {
    await act(async () => {
      setKeyring(keyringFor(orgId), orgId)
    })
  }

  const currentKeyring = () => renders[renders.length - 1].keyring

  beforeEach(() => {
    renders = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('never exposes the previous org keyring after a switch', async () => {
    await renderWithActiveOrg('org-a')
    await unlock('org-a')
    expect(currentKeyring()).toBe('org-a-pk')

    renders = []
    await renderWithActiveOrg('org-b')

    expect(renders.length).toBeGreaterThan(0)
    expect(renders.filter((r) => r.keyring !== null)).toEqual([])
  })

  it('ignores an unlock for an org that is no longer active', async () => {
    await renderWithActiveOrg('org-a')
    await renderWithActiveOrg('org-b')

    // A slow unlock started for org-a resolves after the switch
    await unlock('org-a')
    expect(currentKeyring()).toBeNull()

    await unlock('org-b')
    expect(currentKeyring()).toBe('org-b-pk')
  })

  it('needs a new unlock when switching back to an org', async () => {
    await renderWithActiveOrg('org-a')
    await unlock('org-a')
    await renderWithActiveOrg('org-b')
    await renderWithActiveOrg('org-a')

    expect(currentKeyring()).toBeNull()
  })
})
