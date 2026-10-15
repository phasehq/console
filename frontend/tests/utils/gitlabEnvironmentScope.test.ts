import {
  GITLAB_ALL_ENVIRONMENTS_SCOPE,
  GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT,
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
      hiddenCount: 0,
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
      hiddenCount: 0,
    })
  })

  it('offers a partial match as a custom scope alongside the matches', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'review')).toEqual({
      scopes: ['review/feature-login'],
      customScope: 'review',
      hiddenCount: 0,
    })
  })

  it('does not offer an existing environment as a custom scope', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'staging').customScope).toBeNull()
  })

  it('does not offer an invalid scope', () => {
    expect(gitLabEnvironmentScopeOptions(environments, 'prod;rm')).toEqual({
      scopes: [],
      customScope: null,
      hiddenCount: 0,
    })
  })

  it('offers custom scopes for groups, which have no environments', () => {
    expect(gitLabEnvironmentScopeOptions([], 'production')).toEqual({
      scopes: [],
      customScope: 'production',
      hiddenCount: 0,
    })
  })

  describe('with many environments', () => {
    // Sorted by name, as listed by the API: e.g. review apps, and production last
    const manyEnvironments = [
      ...Array.from({ length: 60 }, (_, i) => `app-${i}-production`),
      'production',
      ...Array.from({ length: 2000 }, (_, i) => `review/branch-${i}`),
    ].sort()

    it('lists a limited number and counts the rest', () => {
      const { scopes, hiddenCount } = gitLabEnvironmentScopeOptions(manyEnvironments, '')

      expect(scopes).toHaveLength(GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT)
      expect(scopes[0]).toBe('*')
      expect(hiddenCount).toBe(2062 - GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT)
    })

    it('searches all environments when typing', () => {
      expect(gitLabEnvironmentScopeOptions(manyEnvironments, 'branch-1999')).toEqual({
        scopes: ['review/branch-1999'],
        customScope: 'branch-1999',
        hiddenCount: 0,
      })
    })

    it('lists a typed environment first, even when many others match', () => {
      const { scopes, customScope, hiddenCount } = gitLabEnvironmentScopeOptions(
        manyEnvironments,
        'production'
      )

      expect(scopes[0]).toBe('production')
      expect(scopes).toHaveLength(GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT)
      expect(customScope).toBeNull()
      expect(hiddenCount).toBe(61 - GITLAB_ENVIRONMENT_SCOPE_OPTIONS_LIMIT)
    })

    it('makes every environment selectable by typing its name', () => {
      for (const environment of manyEnvironments) {
        expect(gitLabEnvironmentScopeOptions(manyEnvironments, environment).scopes[0]).toBe(
          environment
        )
      }
    })
  })
})
