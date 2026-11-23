import { useEffect } from 'react'

/**
 * Sets the browser tab title and keeps it set.
 *
 * The root layout's metadata gives every page the static title "Phase Console". Next renders that
 * <title> again after hydration and after each navigation, which puts it back over a title that was
 * set once from the client. So the title is applied again whenever <head> changes.
 */
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
