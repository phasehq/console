import { useEffect } from 'react'

// Next re-renders the root layout's static <title> after hydration and on each navigation, so the
// title is applied again whenever <head> changes
export const usePageTitle = (title: string) => {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title
    }

    apply()

    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [title])
}
