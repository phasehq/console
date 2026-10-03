import {
  GITLAB_ALL_ENVIRONMENTS_SCOPE,
  gitLabEnvironmentScopeLabel,
  gitLabEnvironmentScopeOptions,
  isValidGitLabEnvironmentScope,
} from '@/utils/syncing/gitlab'

describe('isValidGitLabEnvironmentScope', () => {
  it.each([
    '*',
    'production',
    'review/*',
    'review/feature-login',
    '${CI_ENVIRONMENT_NAME}',
    'prod eu.1',
    ' staging ',
    'a'.repeat(255),
  ])('accepts %s', (scope) => {
    expect(isValidGitLabEnvironmentScope(scope)).toBe(true)
  })

  it.each(['', '   ', 'prod;rm', 'prod?x=1', 'prod\nuction', 'prodüction', 'a'.repeat(256)])(
    'rejects %j',
    (scope) => {
      expect(isValidGitLabEnvironmentScope(scope)).toBe(false)
    }
  )
})

describe('gitLabEnvironmentScopeLabel', () => {
  it('labels the default scope as all environments', () => {
    expect(gitLabEnvironmentScopeLabel(GITLAB_ALL_ENVIRONMENTS_SCOPE)).toBe('All environments')
    expect(gitLabEnvironmentScopeLabel(undefined)).toBe('All environments')
    expect(gitLabEnvironmentScopeLabel(null)).toBe('All environments')
  })

  it('shows other scopes as-is', () => {
    expect(gitLabEnvironmentScopeLabel('review/*')).toBe('review/*')
  })
})

describe('gitLabEnvironmentScopeOptions', () => {
  const environments = ['development', 'production', 'review/feature-login', 'staging']

  it('lists all environments first, then the project environments', () => {
    expect(gitLabEnvironmentScopeOptions(environments, '')).toEqual({
      scopes: ['*', ...environments],
      customScope: null,
    })
  })

  it('does not list the default scope twice', () => {
    expect(gitLabEnvironmentScopeOptions(['*', 'production'], '').scopes).toEqual([
      '*',
      'production',
    ])
  })

  it('filters by scope and label', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'PROD').scopes).toEqual(['production'])
    expect(gitLabEnvironmentScopeOptions(environments, 'all').scopes).toEqual(['*'])
  })

  it('offers a typed wildcard as a custom scope', () => {
    expect(gitLabEnvironmentScopeOptions(environments, ' review/* ')).toEqual({
      scopes: [],
      customScope: 'review/*',
    })
  })

  it('offers a partial match as a custom scope alongside the matches', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'review')).toEqual({
      scopes: ['review/feature-login'],
      customScope: 'review',
    })
  })

  it('does not offer an existing environment as a custom scope', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'staging').customScope).toBeNull()
  })

  it('does not offer an invalid scope', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'prod;rm')).toEqual({
      scopes: [],
      customScope: null,
    })
  })

  it('offers custom scopes for groups, which have no environments', () => {
    expect(gitLabEnvironmentScopeOptions([], 'production')).toEqual({
      scopes: [],
      customScope: 'production',
    })
  })
})
