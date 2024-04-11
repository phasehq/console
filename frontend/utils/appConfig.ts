export const isCloudHosted = () => {
  return (
    process.env.NEXT_PUBLIC_APP_HOST?.trim() === 'cloud' || process.env.APP_HOST?.trim() === 'cloud'
  )
}

export const hostname = `${window.location.protocol}//${window.location.host}`

export const apiHost =
  window.location.host === 'cloud.phase.dev'
    ? 'https://api.phase.dev'
    : `${hostname}/service/public`
