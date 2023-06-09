export const copyToClipBoard = (text: string) => {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false
  )
}
