export function formatCueTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = String(Math.floor(wholeSeconds / 60)).padStart(2, '0')
  const remainingSeconds = String(wholeSeconds % 60).padStart(2, '0')
  return `${minutes}:${remainingSeconds}`
}
