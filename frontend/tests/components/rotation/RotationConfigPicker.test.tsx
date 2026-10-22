import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

const mockUseQuery = jest.fn()
jest.mock('@apollo/client', () => ({ useQuery: (...args: unknown[]) => mockUseQuery(...args) }))
jest.mock(
  '@/graphql/queries/secrets/rotation/getRotationProviderResources.gql',
  () => ({ GetRotationProviderResources: { kind: 'Document' } }),
  { virtual: true }
)

import {
  RotationChoicePicker,
  RotationResourcePicker,
} from '@/ee/components/secrets/rotation/RotationConfigPicker'
import { RotationConfigField } from '@/utils/rotation'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const projectField: RotationConfigField = {
  id: 'project_id',
  label: 'Project',
  required: true,
  resource_type: 'project',
  depends_on: ['region'],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mockUseQuery.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const renderPicker = (props: Partial<React.ComponentProps<typeof RotationResourcePicker>> = {}) => {
  const onChange = jest.fn()
  act(() => {
    root.render(
      <RotationResourcePicker
        providerId="openai"
        credentialId="cred-1"
        field={projectField}
        value=""
        onChange={onChange}
        config={{ region: 'us', name_template: 'phase-{id}' }}
        {...props}
      />
    )
  })
  return onChange
}

it('asks for root credentials before loading options', () => {
  mockUseQuery.mockReturnValue({ data: undefined, loading: false, error: undefined })

  renderPicker({ credentialId: null })

  expect(container.textContent).toContain('Pick root credentials in the previous step')
  expect(mockUseQuery.mock.calls[0][1].skip).toBe(true)
})

it('queries the field resource type with only its dependencies', () => {
  mockUseQuery.mockReturnValue({ data: undefined, loading: true, error: undefined })

  renderPicker()

  const { variables, skip } = mockUseQuery.mock.calls[0][1]
  expect(skip).toBe(false)
  expect(variables).toEqual({
    providerId: 'openai',
    authenticationId: 'cred-1',
    resourceType: 'project',
    config: { region: 'us' },
  })
  expect(container.textContent).toContain('Loading…')
})

it('shows the selected option name and id', () => {
  mockUseQuery.mockReturnValue({
    data: {
      rotationProviderResources: [
        { id: 'proj_a', name: 'Live', description: '' },
        { id: 'proj_b', name: 'Other', description: '' },
      ],
    },
    loading: false,
    error: undefined,
  })

  renderPicker({ value: 'proj_b' })

  expect(container.textContent).toContain('Other (proj_b)')
})

it('summarises multi-select values and keeps unknown ids', () => {
  mockUseQuery.mockReturnValue({
    data: { rotationProviderResources: [{ id: 'p1', name: 'Readers', description: '' }] },
    loading: false,
    error: undefined,
  })

  renderPicker({
    field: { ...projectField, field_type: 'list', depends_on: [] },
    value: ['p1', 'p2'],
  })

  expect(container.textContent).toContain('Readers, p2')
})

it('falls back to manual entry when options fail to load', () => {
  mockUseQuery.mockReturnValue({
    data: undefined,
    loading: false,
    error: new Error('Provider authentication failed'),
  })

  const onChange = renderPicker()

  expect(container.textContent).toContain('Provider authentication failed')
  const input = container.querySelector('input') as HTMLInputElement
  expect(input).not.toBeNull()

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, 'proj_manual')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(onChange).toHaveBeenCalledWith('proj_manual')
})

it('renders static choices without querying the provider', () => {
  act(() => {
    root.render(
      <RotationChoicePicker
        field={{ id: 'access_level', label: 'Access level', choices: ['guest', 'developer'] }}
        value="developer"
        onChange={jest.fn()}
      />
    )
  })

  expect(container.textContent).toContain('developer')
  expect(mockUseQuery).not.toHaveBeenCalled()
})
