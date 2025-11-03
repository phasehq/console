import { getUnixTimeStampinFuture } from './time'

export interface ExpiryOptionT {
  name: string
  getExpiry: () => number | null
}

export const tokenExpiryOptions: ExpiryOptionT[] = [
  {
    name: 'Never',
    getExpiry: () => null,
  },
  {
    name: '7 days',
    getExpiry: () => getUnixTimeStampinFuture(7),
  },
  {
    name: '30 days',
    getExpiry: () => getUnixTimeStampinFuture(30),
  },
  {
    name: '60 days',
    getExpiry: () => getUnixTimeStampinFuture(60),
  },
  {
    name: '90 days',
    getExpiry: () => getUnixTimeStampinFuture(90),
  },
]

export const humanReadableExpiry = (expiryOption: ExpiryOptionT) =>
  expiryOption.getExpiry() === null
    ? 'This token will never expire.'
    : `This token will expire on ${new Date(expiryOption.getExpiry()!).toLocaleDateString()}.`

export const compareExpiryOptions = (a: ExpiryOptionT, b: ExpiryOptionT) => {
  return a.getExpiry() === b.getExpiry()
}
