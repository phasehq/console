import { ApolloLink, Observable } from '@apollo/client'
import type { FetchResult } from '@apollo/client'

type Kind = {
  /** How many reads of the kind have been sent */
  sent: number
  /** How many of them are still out */
  out: number
  /** The read whose answer is the newest passed on, and that answer while another read is out */
  newest: { from: number; result?: FetchResult }
}

const kinds = new Map<string, Kind>()

/**
 * Context for a read that is sent again and again: a poll, a refetch, a read after a write.
 * `kind` names one query with one set of variables. Each read of it is then a request of its
 * own (a later one doesn't share a request already on its way), and `latestAnswerLink` keeps
 * an older answer from landing on top of a newer one.
 */
export const latestAnswer = (kind: string) => ({ latestAnswer: kind, queryDeduplication: false })

/**
 * A read sent before another of its kind can be answered after it, with older data, and Apollo
 * would write that over the newer answer in its cache. An answer that arrives after the answer
 * to a read sent later is replaced by that later answer.
 */
export const latestAnswerLink = new ApolloLink((operation, forward) => {
  const name = operation.getContext().latestAnswer as string | undefined
  if (!name) return forward(operation)

  return new Observable<FetchResult>((observer) => {
    let kind = kinds.get(name)
    if (!kind) kinds.set(name, (kind = { sent: 0, out: 0, newest: { from: 0 } }))
    const reads = kind
    const mine = ++reads.sent
    reads.out += 1

    let out = true
    const back = () => {
      if (!out) return
      out = false
      reads.out -= 1
      // No read is left that could be answered late
      if (reads.out === 0) reads.newest.result = undefined
    }
    const overtaken = () => mine < reads.newest.from

    const subscription = forward(operation).subscribe({
      next: (result) => {
        if (overtaken()) return observer.next({ ...reads.newest.result })
        // A copy: Apollo swaps the data of the result it is handed for its cached form
        reads.newest = { from: mine, result: { ...result } }
        observer.next(result)
      },
      error: (error) => {
        // A newer answer is in: the read has that rather than its own failure
        if (overtaken()) {
          observer.next({ ...reads.newest.result })
          observer.complete()
        } else observer.error(error)
        back()
      },
      complete: () => {
        back()
        observer.complete()
      },
    })

    return () => {
      subscription.unsubscribe()
      back()
    }
  })
})
