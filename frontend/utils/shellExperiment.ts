'use client'

// TEMPORARY: for trying variants of the sidebar-only shell on this branch. Remove this commit before merging.
// Set the switches from the browser console and reload, for example:
//   localStorage.setItem('shell-experiment', JSON.stringify({ breadcrumbs: true, hideTabs: true }))
// and clear them with localStorage.removeItem('shell-experiment').
import { useEffect, useState } from 'react'

export type ShellExperiment = {
  // Show the breadcrumb trail (with the org switcher) as a slim row at the top of the page panel
  breadcrumbs: boolean
  // Draw the page as an inset card instead of a full-height pane
  inset: boolean
  // Hide the Access and Integrations tab bars while the sidebar lists their sub-pages
  hideTabs: boolean
  // Also drop those sections' own page heading, which repeats the sidebar group
  hideSectionHeading: boolean
  // Pretend to be cloud-hosted, so the status in the Help menu can be seen locally: true for a
  // healthy status, or an incident level
  mockStatus: boolean | 'minor' | 'major' | 'critical'
}

const DEFAULTS: ShellExperiment = {
  breadcrumbs: false,
  inset: false,
  hideTabs: false,
  hideSectionHeading: false,
  mockStatus: false,
}

export const useShellExperiment = () => {
  const [flags, setFlags] = useState(DEFAULTS)

  useEffect(() => {
    try {
      setFlags({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('shell-experiment') ?? '{}') })
    } catch {
      // Keep the defaults
    }
  }, [])

  return flags
}
