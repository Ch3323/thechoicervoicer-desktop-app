import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, X } from 'lucide-react'
import {
  dismissErrorToast,
  getErrorToasts,
  subscribeToErrorToasts,
} from '@/lib/error-toast'

function ErrorToastItem({ id, message }: { id: number; message: string }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (hovered || focused) return
    const timeout = window.setTimeout(() => dismissErrorToast(id), 8000)
    return () => window.clearTimeout(timeout)
  }, [id, hovered, focused])

  return (
    <div
      className="error-toast"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-300" />
      <p role="alert" className="min-w-0 flex-1 wrap-anywhere">{message}</p>
      <button
        type="button"
        aria-label="Dismiss error"
        className="shrink-0 rounded-none p-1 text-red-200 hover:bg-white/10"
        onClick={() => dismissErrorToast(id)}
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

export function ErrorToasts() {
  const toasts = useSyncExternalStore(subscribeToErrorToasts, getErrorToasts)
  const [host, setHost] = useState<Element>(document.body)
  const viewportRef = useRef<HTMLDivElement>(null)
  const hasToasts = toasts.length > 0

  useLayoutEffect(() => {
    // A native modal makes the rest of the document inert. Mount the toast
    // inside the active dialog so its dismissal and announcements still work.
    let currentHost: Element = document.body
    const updateHost = () => {
      const dialogs = document.querySelectorAll('dialog:modal')
      const nextHost =
        document.activeElement?.closest('dialog:modal') ??
        dialogs[dialogs.length - 1] ??
        document.body
      if (nextHost === currentHost) return
      currentHost = nextHost
      setHost(nextHost)
    }
    updateHost()
    const observer = new MutationObserver((records) => {
      if (!currentHost.isConnected || records.some(
        ({ type, target }) => type === 'attributes' && target instanceof HTMLDialogElement,
      )) updateHost()
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    // The top layer also lets the toast escape the dialog's clipping.
    if (host !== document.body && viewport?.showPopover) {
      viewport.setAttribute('popover', 'manual')
      viewport.showPopover()
    }
  }, [hasToasts, host])

  return createPortal(
    hasToasts && (
      <div ref={viewportRef} className="error-toast-viewport">
        {toasts.slice(0, 3).map((toast) => <ErrorToastItem key={toast.id} {...toast} />)}
      </div>
    ),
    host,
  )
}
