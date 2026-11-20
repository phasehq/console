import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import { AppDynamicSecretKeyRow } from '@/app/[team]/apps/[app]/_components/AppDynamicSecretKeyRow'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = (id: string, name: string) => ({ id, name }) as EnvironmentType
const dynamicSecret = (...names: string[]) =>
  ({ keyMap: names.map((keyName) => ({ id: keyName, keyName })) }) as unknown as DynamicSecretType

const dev = env('dev', 'Development')
const staging = env('staging', 'Staging')
const prod = env('prod', 'Production')
const qa = env('qa', 'QA')
// QA's column is hidden; it maps the key
const columns = [dev, staging, prod].map((e) => ({ env: e, checked: true, pending: false }))
columns.push({ env: qa, checked: false, pending: false })

it('marks a key only where a lease returns it', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <table>
        <tbody>
          <AppDynamicSecretKeyRow
            index={0}
            depth={0}
            keyName="AWS_IAM_USERNAME"
            envs={[
              { env: dev, dynamicSecret: dynamicSecret('AWS_IAM_USERNAME', 'AWS_ACCESS_KEY_ID') },
              { env: staging, dynamicSecret: dynamicSecret('AWS_ACCESS_KEY_ID') },
              { env: prod, dynamicSecret: null },
              { env: qa, dynamicSecret: dynamicSecret('AWS_IAM_USERNAME') },
            ]}
            columns={columns}
            showEnv={() => {}}
          />
        </tbody>
      </table>
    )
  })

  const [, inDev, inStaging, inProd, inQa] = [...container.querySelectorAll('td')]
  expect(inDev.textContent).toContain('••••••')
  // Set up in Staging, where a lease returns other keys
  expect(inStaging.textContent).not.toContain('•')
  expect(inStaging.querySelector('[title]')?.getAttribute('title')).toBe(
    "A lease in Staging doesn't return AWS_IAM_USERNAME"
  )
  expect(inProd.querySelector('[title]')?.getAttribute('title')).toBe(
    "This dynamic secret isn't set up in Production"
  )
  expect(inQa.querySelector('button')?.getAttribute('title')).toBe(
    'Set up in QA — click to show QA'
  )

  await act(async () => root.unmount())
  container.remove()
})
