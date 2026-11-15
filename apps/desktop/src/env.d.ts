/// <reference types="vite/client" />

import type { DesktopApi } from '@studio/shared'

declare global {
  interface Window {
    studio: DesktopApi
  }
}

export {}
