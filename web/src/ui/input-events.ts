import { useSyncExternalStore, type KeyboardEvent } from 'react'

/**
 * True while an IME is composing: the Enter that commits a Japanese conversion must not also add, save or submit.
 * Safari reports the committing keydown with `isComposing` false but keyCode 229.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/** For text inputs inside a form: stops a composing Enter from submitting it. */
export function blockComposingEnter(event: KeyboardEvent) {
  if (event.key === 'Enter' && isComposing(event)) event.preventDefault()
}

/** Whether a CSS media query matches, kept current. False during server rendering. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
