import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  overwrite: true,
  schema: 'apollo/schema.graphql',
  //documents: 'apollo/**/*.graphql',
  generates: {
    'apollo/': {
      preset: 'client',
      plugins: ['typescript'],
    },
  },
}

export default config
