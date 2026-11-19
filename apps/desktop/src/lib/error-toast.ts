import { playerError } from '@/lib/player-error'

type ErrorToast = { id: number; message: string }

const listeners = new Set<() => void>()
let toasts: ErrorToast[] = []
let nextId = 0

function publish(next: ErrorToast[]) {
  toasts = next
  for (const listener of listeners) listener()
}

export function subscribeToErrorToasts(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getErrorToasts() {
  return toasts
}

export function dismissErrorToast(id: number) {
  publish(toasts.filter((toast) => toast.id !== id))
}

export function reportError(reason: unknown, fallback?: string) {
  const message = playerError(reason, fallback)
  if (toasts.some((toast) => toast.message === message)) return

  publish([...toasts, { id: ++nextId, message }])
}
