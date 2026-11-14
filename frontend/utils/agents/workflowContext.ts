/** What a Workflow's context may hold. The backend stores at most this many characters. */
export const CONTEXT_MAX_LENGTH = 16384

/** Context longer than this starts collapsed. */
const LONG_CONTEXT_CHARACTERS = 600
const LONG_CONTEXT_LINES = 12

export const isLongContext = (markdown: string) =>
  markdown.length > LONG_CONTEXT_CHARACTERS || markdown.split('\n').length > LONG_CONTEXT_LINES

/** Why the text cannot be saved, or ''. Credential-shaped text is refused by the server. */
export const contextProblem = (markdown: string, stored: string): string => {
  if (markdown.length > CONTEXT_MAX_LENGTH)
    return `Use at most ${CONTEXT_MAX_LENGTH.toLocaleString()} characters.`
  if (markdown === stored) return 'Nothing has changed.'
  return ''
}
