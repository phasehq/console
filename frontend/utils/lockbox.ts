import { Maybe } from 'graphql/jsutils/Maybe'

export const getBox = async (boxId: string) => {
  const res = await fetch(`${process.env.BACKEND_API_BASE}/lockbox/${boxId}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to fetch data')
  }

  return res.json()
}

export const updateBoxViewCount = async (boxId: string) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/lockbox/${boxId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'omit',
  })
}

export const boxExpiryString = (expiresAt?: number, allowedViews?: Maybe<number>) => {
  if (!expiresAt && !allowedViews) {
    return 'This box will never expire'
  }

  let expiryDescription = 'This box will expire '

  if (expiresAt) {
    const expiryDate = new Date(expiresAt)
    const now = new Date()
    const millisecondsUntilExpiry = expiryDate.getTime() - now.getTime()

    if (millisecondsUntilExpiry <= 0) {
      return 'This box has expired'
    }

    const secondsUntilExpiry = Math.floor(millisecondsUntilExpiry / 1000)
    const minutesUntilExpiry = Math.floor(secondsUntilExpiry / 60)
    const hoursUntilExpiry = Math.floor(minutesUntilExpiry / 60)
    const daysUntilExpiry = Math.floor(hoursUntilExpiry / 24)

    if (daysUntilExpiry > 0) {
      expiryDescription += `in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? 's' : ''}`
    } else if (hoursUntilExpiry > 0) {
      expiryDescription += `in ${hoursUntilExpiry} hour${hoursUntilExpiry > 1 ? 's' : ''}`
    } else if (minutesUntilExpiry > 0) {
      expiryDescription += `in ${minutesUntilExpiry} minute${minutesUntilExpiry > 1 ? 's' : ''}`
    } else {
      expiryDescription += 'soon'
    }
  }

  if (allowedViews) {
    if (expiresAt) {
      expiryDescription += ' or '
    }
    expiryDescription += `after being viewed ${allowedViews} time${allowedViews > 1 ? 's' : ''}`
  }

  return expiryDescription
}
