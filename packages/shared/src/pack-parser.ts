import { DubPackSchema, type DubPack } from './models'

export interface PackFile {
  /** Path relative to the pack root, with forward slashes. */
  path: string
  /** Present for metadata and text sidecars only. */
  text?: string
}

export interface PackParseInput {
  id: string
  source: DubPack['source']
  folderName: string
  files: PackFile[]
}

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackValidationError'
  }
}

type IniData = Record<string, string>

function parseIni(text: string): IniData {
  const result: IniData = {}
  let section = ''
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const heading = /^\[([^\]]+)\]$/.exec(line)
    if (heading) {
      section = heading[1].trim().toLowerCase()
      continue
    }
    if (section !== 'data') continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    result[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim()
  }
  return result
}

function scalar(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1).replace(/\\"/g, '"')
    }
  }
  return raw
}

function array(raw: string | undefined): string[] {
  if (!raw?.startsWith('[') || !raw.endsWith(']')) return []
  const body = raw.slice(1, -1)
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let escaped = false
  for (const char of body) {
    if (escaped) {
      token += char
      escaped = false
    } else if (char === '\\' && quoted) {
      token += char
      escaped = true
    } else if (char === '"') {
      token += char
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      tokens.push(token.trim())
      token = ''
    } else {
      token += char
    }
  }
  if (token.trim()) tokens.push(token.trim())
  return tokens.map((part) => scalar(part) ?? '').filter(Boolean)
}

function timestamp(value: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
  const parts = value.split(':')
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))
  )
    return null
  const numbers = parts.map(Number)
  const seconds = numbers.pop()!
  const minutes = numbers.pop()!
  if (seconds >= 60 || (minutes >= 60 && numbers.length > 0)) return null
  return (numbers[0] ?? 0) * 3600 + minutes * 60 + seconds
}

function isConfigText(text: string): boolean {
  return (
    /^\s*\[data\]\s*$/im.test(text) ||
    /^\s*(caption|image|dub_timestamps|dub_characters)\s*=/im.test(text)
  )
}

function stem(path: string): string {
  return path.replace(/\.[^.]+$/, '')
}

function stableNameId(name: string): string {
  return `character:${name.toLocaleLowerCase()}`
}

export function parseDubPack(input: PackParseInput): DubPack {
  const files = input.files.filter(
    (file) => !file.path.includes('/') && !file.path.includes('\\'),
  )
  const byLower = new Map(files.map((file) => [file.path.toLowerCase(), file]))
  const video = byLower.get('dub_video.ogv')
  if (!video)
    throw new PackValidationError(
      'This folder is not a Dub Pack: dub_video.ogv is missing.',
    )

  const findAsset = (
    base: string,
    extensions: readonly string[],
  ): string | undefined => {
    const exact = byLower.get(base.toLowerCase())
    if (exact) return exact.path
    for (const extension of extensions) {
      const match = byLower.get(`${base}.${extension}`.toLowerCase())
      if (match) return match.path
    }
    return undefined
  }

  const infoFile = ['_pack_info.ini', '_pack_info.cfg', '_pack_info.txt']
    .map((name) => byLower.get(name))
    .find((file) => file?.text && isConfigText(file.text))
  const info = parseIni(infoFile?.text ?? '')
  const title = scalar(info.title)?.trim() || input.folderName
  const subtitle =
    scalar(info.subtitle)?.trim() ||
    byLower.get('_subtitle.txt')?.text?.trim() ||
    undefined
  const authors = array(info.authors)
    .map((name) => name.trim())
    .filter(Boolean)
  if (authors.length === 0) {
    const author = byLower.get('_author.txt')?.text?.trim()
    if (author) authors.push(author)
  }

  const declaredIcon = scalar(info.icon)?.trim()
  const iconRef =
    (declaredIcon && findAsset(declaredIcon, ['png', 'jpg', 'jpeg'])) ||
    findAsset('_icon', ['png', 'jpg', 'jpeg']) ||
    findAsset('_pack_filler_image', ['png', 'jpg', 'jpeg'])
  const backingTrackRef = findAsset('_backing_track', [
    'mp3',
    'ogg',
    'wav',
    'm4a',
  ])

  const characters = new Map<string, DubPack['characters'][number]>()
  const dialogues: DubPack['dialogues'] = []
  const warnings: string[] = []
  const audioFiles = files
    .filter(
      (file) =>
        /\.(mp3|ogg|wav)$/i.test(file.path) &&
        !/^_backing_track\./i.test(file.path),
    )
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  for (const audio of audioFiles) {
    const base = stem(audio.path)
    const candidates = ['ini', 'cfg', 'txt'].map((ext) =>
      byLower.get(`${base}.${ext}`.toLowerCase()),
    )
    const metadataFile = candidates.find(
      (file) => file?.text && isConfigText(file.text),
    )
    const captionSidecar = byLower.get(`${base}.txt`.toLowerCase())
    const data = parseIni(metadataFile?.text ?? '')
    const timestamps = array(data.dub_timestamps)
    if (timestamps.length === 0) {
      warnings.push(`${audio.path}: no dub_timestamps; sample skipped.`)
      continue
    }

    const names = array(data.dub_characters)
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length === 0) names.push('Unassigned')
    const characterIds = [...new Set(names.map(stableNameId))]
    for (const name of names) {
      const id = stableNameId(name)
      if (!characters.has(id))
        characters.set(id, {
          id,
          name,
          inferred: name === 'Unassigned' && !data.dub_characters,
        })
    }

    const declaredImage = scalar(data.image)?.trim()
    const imageRef =
      (declaredImage && findAsset(declaredImage, ['png', 'jpg', 'jpeg'])) ||
      findAsset(base, ['png', 'jpg', 'jpeg']) ||
      findAsset('_pack_filler_image', ['png', 'jpg', 'jpeg']) ||
      iconRef
    const plainCaption =
      captionSidecar?.text && !isConfigText(captionSidecar.text)
        ? captionSidecar.text.trim()
        : undefined
    const caption = plainCaption || scalar(data.caption)?.trim() || undefined

    timestamps.forEach((raw, occurrenceIndex) => {
      const timestampSeconds = timestamp(raw)
      if (timestampSeconds === null || !Number.isFinite(timestampSeconds)) {
        warnings.push(
          `${audio.path}: invalid timestamp ${raw}; occurrence skipped.`,
        )
        return
      }
      dialogues.push({
        id: `${input.id}:${audio.path.toLowerCase()}:${occurrenceIndex}`,
        sourceRef: audio.path,
        metadataRef: metadataFile?.path,
        occurrenceIndex,
        timestampSeconds,
        caption,
        characterIds,
        imageRef,
      })
    })
  }

  if (dialogues.length === 0)
    throw new PackValidationError(
      'No valid dialogue timestamps were found in this Dub Pack.',
    )
  dialogues.sort(
    (a, b) =>
      a.timestampSeconds - b.timestampSeconds || a.id.localeCompare(b.id),
  )

  const candidate = {
    id: input.id,
    source: input.source,
    metadata: {
      title,
      subtitle,
      authors,
      readme: scalar(info.readme)?.trim() || undefined,
    },
    videoRef: video.path,
    backingTrackRef,
    iconRef,
    characters: [...characters.values()],
    dialogues,
    warnings,
  }
  const validated = DubPackSchema.safeParse(candidate)
  if (!validated.success)
    throw new PackValidationError(
      validated.error.issues.map((issue) => issue.message).join('; '),
    )
  return validated.data
}
