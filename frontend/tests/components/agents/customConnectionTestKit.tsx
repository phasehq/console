import React, { act } from 'react'

/** Shared stand-ins for the custom Connection component tests. */

export const dialogMock = () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    __esModule: true,
    default: ReactModule.forwardRef(function MockDialog(
      { children, title, buttonContent, onOpen, onClose }: any,
      ref: any
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ openModal: onOpen, closeModal: onClose }))
      return (
        <div>
          {buttonContent ? (
            <button type="button" aria-label={`Open ${title}`} onClick={onOpen}>
              {buttonContent}
            </button>
          ) : null}
          {children}
          <button type="button" aria-label={`Close ${title}`} onClick={onClose}>
            Close dialog
          </button>
        </div>
      )
    }),
  }
}

export const selectMock = () => ({
  AgentSelect: ({ id, value, onChange, options }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
})

export const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The input a visible label or an aria-label names. */
export const field = (container: HTMLElement, label: string) => {
  const byAria = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (byAria) return byAria
  const named = Array.from(container.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.replace(/\*$/, '').trim().startsWith(label)
  )
  const input = named?.htmlFor
    ? container.querySelector<HTMLInputElement>(`[id="${named.htmlFor}"]`)
    : null
  if (!input) throw new Error(`No input labelled ${label}`)
  return input
}

export const buttonNamed = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent === label
  )

export const click = async (container: HTMLElement, label: string) => {
  const button = buttonNamed(container, label)
  if (!button) throw new Error(`No button named ${label}`)
  await act(async () => button.click())
}

/** Let the sealing and the mutation, both asynchronous, run to completion. */
export const settle = async (done: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !done(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}
