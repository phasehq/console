import { TextEncoder } from 'util'
import { DuplicateSecretKeyMessage } from '@/components/environments/secrets/DuplicateSecretKeyMessage'

global.TextEncoder = TextEncoder

describe('DuplicateSecretKeyMessage', () => {
  test('connects an invalid input to a private, scope-specific message', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(
      <DuplicateSecretKeyMessage isDuplicate={true} duplicateKeyNumber={4}>
        {(descriptionId) => (
          <input aria-invalid={true} aria-describedby={descriptionId} />
        )}
      </DuplicateSecretKeyMessage>
    )

    expect(html).toContain('aria-invalid="true"')
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(descriptionId).toBeDefined()
    expect(html).toContain(`id="${descriptionId}"`)
    expect(html).toContain('ph-no-capture')
    expect(html).toContain('Check key #4')
    expect(html).not.toContain('PRIVATE_KEY')
  })

  test('omits the message and description when the key is valid', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(
      <DuplicateSecretKeyMessage isDuplicate={false}>
        {(descriptionId) => <input aria-describedby={descriptionId} />}
      </DuplicateSecretKeyMessage>
    )

    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('This key already exists')
  })

  test('explains when filters hide the conflicting key', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(
      <DuplicateSecretKeyMessage isDuplicate={true}>
        {() => <input />}
      </DuplicateSecretKeyMessage>
    )

    expect(html).toContain('Clear filters to find it')
  })
})
