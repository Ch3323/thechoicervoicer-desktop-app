/** Keep diagnostic text out of player-facing alerts while retaining useful guidance. */
export function playerError(reason: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = reason instanceof Error
    ? `${reason.name === 'Error' ? '' : `${reason.name}: `}${reason.message}`
    : String(reason ?? '')
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '').trim()

  if (!message) return fallback

  if (/notallowederror|permission dismissed|microphone.*permission/i.test(message))
    return 'Microphone access was blocked. Allow microphone access in your device settings, then try again.'
  if (/notfounderror|requested device not found/i.test(message))
    return 'No microphone was found. Connect a microphone, then try again.'
  if (/notreadableerror|trackstarterror/i.test(message))
    return 'The microphone is in use or unavailable. Close other apps using it, then try again.'
  if (/\b(EACCES|EPERM)\b|permission denied/i.test(message))
    return 'Access was denied. Check the file or folder permissions, then try again.'
  if (/\b(ENOENT|ENOTDIR)\b|no such file or directory/i.test(message))
    return 'A needed file could not be found. Check that the Dub Pack is still in place, then try again.'
  if (/\b(ENOSPC)\b|no space left on device/i.test(message))
    return 'Your device is out of space. Free up some space, then try again.'
  if (/\b(EBUSY|EEXIST)\b|file is being used by another process/i.test(message))
    return 'That file is in use. Close it in other apps, then try again.'
  if (/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b|fetch failed|network error/i.test(message))
    return 'Could not connect. Check your connection and the Host address, then try again.'
  if (/ffmpeg|ffprobe|\bcodec\b|invalid data found when processing input/i.test(message))
    return 'This video or audio could not be processed. Check that the file plays normally, then try again.'
  if (/name already taken/i.test(message))
    return 'That name is already in use. Choose another name to join.'
  if (/room not found|could not connect to the host|host did not respond/i.test(message))
    return 'Could not find the room. Check the code and Host address, then try again.'

  // Validation errors written for players can pass through once Electron's wrapper is removed.
  // Paths, stack traces, status codes, and runtime errors need a safe fallback.
  if (/(?:[A-Z]:\\|\/[^\s]+\/|at\s+\S+\s*\(|\b(?:TypeError|SyntaxError|ReferenceError)\b|\b(?:HTTP\s*)?[45]\d\d\b|\b[A-Z]{2,}_\w+\b|cannot read properties|undefined is not)/i.test(message)
    || message.includes('\n') || message.length > 220)
    return fallback

  return message
}
