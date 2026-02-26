'use client'

import { createContext } from 'react'
import { ReferenceContext } from '@/utils/secretReferences'

export const SecretReferenceContext = createContext<ReferenceContext>({
  teamSlug: '',
  appId: '',
  envIds: {},
  secretIdLookup: {},
  secretKeys: [],
  envSecretKeys: {},
  envRootKeys: {},
  envNames: [],
  folderPaths: [],
  folderSecretKeys: {},
  orgApps: [],
  deletedKeys: [],
})
