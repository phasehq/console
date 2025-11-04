export type OrganisationKeyring = {
  symmetricKey: string
  publicKey: string
  privateKey: string
}

export type AppKeyring = {
  publicKey: string
  privateKey: string
}

export type EnvKeyring = {
  privateKey: string
  publicKey: string
  salt: string
}

export type EnvKeypair = {
  publicKey: string
  privateKey: string
}
