export const isCloudHosted = () => {
  return (
    process.env.NEXT_PUBLIC_APP_HOST?.trim() === 'cloud' || process.env.APP_HOST?.trim() === 'cloud'
  )
}
