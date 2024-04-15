export const isCloudHosted = () => {
  return (
    process.env.NEXT_PUBLIC_APP_HOST?.trim() === 'cloud' || process.env.APP_HOST?.trim() === 'cloud'
  )
}

export const getHostname = () => `${window.location.protocol}//${window.location.host}`

export const getApiHost = () => {
  return isCloudHosted() ? 'https://api.phase.dev' : `${getHostname()}/service/public`
}
