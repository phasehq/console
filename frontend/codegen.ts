import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  overwrite: true,
  schema: 'apollo/schema.graphql',
  documents: ['graphql/**/*.gql'],
  generates: {
    'apollo/': {
      preset: 'client',
      plugins: [],
    },
  },
}

export default config
