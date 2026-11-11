import { ApiSecretTypeChoices, SecretType } from '@/apollo/graphql'
import { emptyFoldersToCreate, secretsToClone } from '@/utils/environmentClone'

const secret = (id: string, extra: Partial<SecretType> = {}) =>
  ({ id, key: id.toUpperCase(), value: 'v', path: '/', type: ApiSecretTypeChoices.Secret, ...extra }) as SecretType

describe('secretsToClone', () => {
  const secrets = [
    secret('a'),
    secret('b', { type: ApiSecretTypeChoices.Sealed, value: '' }),
    secret('c', { rotatingSecretId: 'rotation-1' }),
  ]

  it('takes every secret but the sealed ones and those a rotation manages', () => {
    expect(secretsToClone(secrets).map((s) => s.id)).toEqual(['a'])
  })

  it('narrows to a chosen few, which may belong to other envs too', () => {
    expect(secretsToClone(secrets, new Set(['a', 'c', 'elsewhere'])).map((s) => s.id)).toEqual(['a'])
    expect(secretsToClone(secrets, new Set(['b', 'c']))).toEqual([])
  })
})

describe('emptyFoldersToCreate', () => {
  const folders = [
    { name: 'dead-letter', path: '/workers/queues' },
    { name: 'workers', path: '/' },
    { name: 'queues', path: '/workers' },
    { name: 'billing', path: '/' },
    { name: 'archive', path: '/billing' },
  ]

  it('leaves out folders a copied secret sits in or under', () => {
    const left = emptyFoldersToCreate(folders, ['/', '/workers/queues'])
    expect(left.map((f) => f.name)).toEqual(['billing', 'archive', 'dead-letter'])
  })

  it('lists parents before their children, so none is created twice', () => {
    const names = emptyFoldersToCreate(folders, []).map((f) => f.name)
    expect(names.indexOf('workers')).toBeLessThan(names.indexOf('queues'))
    expect(names.indexOf('queues')).toBeLessThan(names.indexOf('dead-letter'))
    expect(names.indexOf('billing')).toBeLessThan(names.indexOf('archive'))
  })
})
