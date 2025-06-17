export const isCloudHosted = () => {
  return (
    process.env.NEXT_PUBLIC_APP_HOST?.trim() === 'cloud' || process.env.APP_HOST?.trim() === 'cloud'
  )
}

export const getHostname = () => process.env.HTTP_PROTOCOL ? `${process.env.HTTP_PROTOCOL}${process.env.HOST}` :  `${window.location.protocol}//${window.location.host}`

export const getApiHost = () => {
  return isCloudHosted() ? 'https://api.phase.dev' : `${getHostname()}/service/public`
}

export const getHealth = async (baseUrl: string) => {
  const res = await fetch(`${baseUrl}/493c5048-99f9-4eac-ad0d-98c3740b491f/health`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to fetch data')
  }

  return res.json()
}
