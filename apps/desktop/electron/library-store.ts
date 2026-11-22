import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  DubPackSchema,
  DubbingProjectSchema,
  RecordingTakeSchema,
  dialogueMatchesRoles,
  selectRoles,
  type DubPack,
  type DubbingProject,
  type RecordingTake,
  type VoiceEffect,
} from '@studio/shared'

const LibrarySchema = z
  .object({
    packs: z.array(DubPackSchema),
    projects: z.array(DubbingProjectSchema),
    takes: z.array(RecordingTakeSchema).default([]),
  })
  .superRefine((library, context) => {
    const selected = new Set<string>()
    for (const take of library.takes) {
      if (!take.selected) continue
      const key = `${take.projectId}:${take.dialogueId}`
      if (selected.has(key))
        context.addIssue({
          code: 'custom',
          message: `Multiple selected takes for ${key}`,
        })
      selected.add(key)
    }
  })

type Library = z.infer<typeof LibrarySchema>

export class LibraryStore {
  private readonly file: string
  private queue: Promise<unknown> = Promise.resolve()
  private cache: Library | null = null
  private loading: Promise<Library> | null = null

  constructor(userData: string) {
    this.file = join(userData, 'library.json')
  }

  private async read(): Promise<Library> {
    return structuredClone(await this.readSnapshot())
  }

  private async readSnapshot(): Promise<Library> {
    if (this.cache) return this.cache
    if (this.loading) return this.loading
    this.loading = this.readFromDisk()
    try {
      const data = await this.loading
      this.cache = data
      return data
    } finally {
      this.loading = null
    }
  }

  private async readFromDisk(): Promise<Library> {
    try {
      return LibrarySchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { packs: [], projects: [], takes: [] }
      throw new Error(
        'The local pack library could not be read. Its data was not changed.',
        { cause: error },
      )
    }
  }

  private async write(data: Library): Promise<void> {
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
      await rename(temp, this.file)
      this.cache = structuredClone(data)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  private mutate<T>(operation: (data: Library) => Promise<T> | T): Promise<T> {
    const pending = this.queue.then(async () => {
      const data = await this.read()
      const value = await operation(data)
      await this.write(data)
      return value
    })
    this.queue = pending.catch(() => undefined)
    return pending
  }

  async listPacks(): Promise<DubPack[]> {
    return (await this.read()).packs
  }

  async getPack(id: string): Promise<DubPack | null> {
    const pack = (await this.readSnapshot()).packs.find((item) => item.id === id)
    return pack ? structuredClone(pack) : null
  }

  async savePack(pack: DubPack): Promise<void> {
    await this.mutate((data) => {
      const index = data.packs.findIndex((existing) => existing.id === pack.id)
      if (index < 0) data.packs.push(pack)
      else data.packs[index] = pack
    })
  }

  async syncRoomSnapshot(
    pack: DubPack,
    project: DubbingProject,
    takes: RecordingTake[],
  ): Promise<void> {
    await this.mutate((data) => {
      data.packs = [pack]
      data.projects = [project]
      data.takes = takes
    })
  }

  async saveRoomHistory(
    project: DubbingProject,
    takes: RecordingTake[],
  ): Promise<void> {
    await this.mutate((data) => {
      if (!data.packs.some((pack) => pack.id === project.packId))
        throw new Error('The room Dub Pack is no longer in the library.')
      const index = data.projects.findIndex((item) => item.id === project.id)
      if (index < 0) data.projects.push(project)
      else {
        const existing = data.projects[index]
        data.projects[index] = {
          ...project,
          lastExportPath: existing.lastExportPath,
          updatedAt:
            existing.updatedAt > project.updatedAt
              ? existing.updatedAt
              : project.updatedAt,
        }
      }
      const incoming = new Set(takes.map((take) => take.id))
      const selected = new Set(
        takes.filter((take) => take.selected).map((take) => take.dialogueId),
      )
      data.takes = data.takes
        .filter(
          (take) => take.projectId !== project.id || !incoming.has(take.id),
        )
        .map((take) =>
          take.projectId === project.id &&
          take.selected &&
          selected.has(take.dialogueId)
            ? { ...take, selected: false }
            : take,
        )
      data.takes.push(...takes)
    })
  }

  async removePack(
    id: string,
  ): Promise<{ pack: DubPack; projectIds: string[] }> {
    return this.mutate((data) => {
      const index = data.packs.findIndex((pack) => pack.id === id)
      if (index < 0) throw new Error('Pack not found')
      const projectIds = data.projects
        .filter((project) => project.packId === id)
        .map((project) => project.id)
      const removedIds = new Set(projectIds)
      data.projects = data.projects.filter(
        (project) => !removedIds.has(project.id),
      )
      data.takes = data.takes.filter((take) => !removedIds.has(take.projectId))
      return { pack: data.packs.splice(index, 1)[0], projectIds }
    })
  }

  async listProjects(): Promise<DubbingProject[]> {
    return (await this.read()).projects
  }

  async getProject(id: string): Promise<DubbingProject | null> {
    return (
      (await this.read()).projects.find((project) => project.id === id) ?? null
    )
  }

  async createProject(
    packId: string,
    session: DubbingProject['session'] = 'single',
  ): Promise<DubbingProject> {
    return this.mutate((data) => {
      const pack = data.packs.find((item) => item.id === packId)
      if (!pack) throw new Error('Pack not found in the library')
      const now = new Date().toISOString()
      const project = DubbingProjectSchema.parse({
        id: randomUUID(),
        packId,
        session,
        createdAt: now,
        updatedAt: now,
        enabledCharacterIds: pack.characters.map((character) => character.id),
      })
      data.projects.push(project)
      return project
    })
  }

  async deleteProject(id: string): Promise<RecordingTake[]> {
    return this.mutate((data) => {
      const index = data.projects.findIndex((project) => project.id === id)
      if (index < 0) throw new Error('Project not found')
      data.projects.splice(index, 1)
      const removed = data.takes.filter((take) => take.projectId === id)
      data.takes = data.takes.filter((take) => take.projectId !== id)
      return removed
    })
  }

  async updateRoles(
    projectId: string,
    characterIds: string[],
  ): Promise<DubbingProject> {
    return this.mutate((data) => {
      const index = data.projects.findIndex(
        (project) => project.id === projectId,
      )
      if (index < 0) throw new Error('Project not found')
      const pack = data.packs.find(
        (item) => item.id === data.projects[index].packId,
      )
      if (!pack) throw new Error('Project pack is missing')
      const updated = selectRoles(
        data.projects[index],
        pack.characters.map((character) => character.id),
        characterIds,
      )
      data.projects[index] = updated
      return updated
    })
  }

  async updateVoiceEffect(
    projectId: string,
    dialogueId: string,
    effect: VoiceEffect,
  ): Promise<DubbingProject> {
    return this.mutate((data) => {
      const project = data.projects.find((item) => item.id === projectId)
      const pack = data.packs.find((item) => item.id === project?.packId)
      if (!project || !pack?.dialogues.some((item) => item.id === dialogueId))
        throw new Error('Project dialogue not found')
      project.voiceEffects = { ...project.voiceEffects, [dialogueId]: effect }
      project.updatedAt = new Date().toISOString()
      return project
    })
  }

  async listTakes(projectId: string): Promise<RecordingTake[]> {
    return (await this.read()).takes.filter(
      (take) => take.projectId === projectId,
    )
  }

  async getTake(takeId: string): Promise<RecordingTake | null> {
    return (await this.read()).takes.find((take) => take.id === takeId) ?? null
  }

  async addTake(take: RecordingTake): Promise<RecordingTake> {
    return this.mutate((data) => {
      const project = data.projects.find((item) => item.id === take.projectId)
      const pack = data.packs.find((item) => item.id === project?.packId)
      const dialogue = pack?.dialogues.find(
        (item) => item.id === take.dialogueId,
      )
      if (!project || !dialogue)
        throw new Error('Recording target is unavailable')
      if (!dialogueMatchesRoles(dialogue, project.enabledCharacterIds))
        throw new Error(
          'Enable a character for this dialogue before saving a recording',
        )
      if (data.takes.some((item) => item.id === take.id))
        throw new Error('Recording ID already exists')
      const validated = RecordingTakeSchema.parse(take)
      for (const existing of data.takes) {
        if (
          existing.projectId === take.projectId &&
          existing.dialogueId === take.dialogueId
        )
          existing.selected = false
      }
      data.takes.push({ ...validated, selected: true })
      project.updatedAt = new Date().toISOString()
      return data.takes[data.takes.length - 1]
    })
  }

  async selectTake(
    projectId: string,
    dialogueId: string,
    takeId: string,
  ): Promise<RecordingTake> {
    return this.mutate((data) => {
      const take = data.takes.find((item) => item.id === takeId)
      if (
        !take ||
        take.projectId !== projectId ||
        take.dialogueId !== dialogueId
      )
        throw new Error('Recording take not found for this dialogue')
      for (const existing of data.takes) {
        if (
          existing.projectId === projectId &&
          existing.dialogueId === dialogueId
        )
          existing.selected = existing.id === takeId
      }
      const project = data.projects.find((item) => item.id === projectId)
      if (project) project.updatedAt = new Date().toISOString()
      return take
    })
  }

  async updateTakeOffset(
    takeId: string,
    offsetSeconds: number,
  ): Promise<RecordingTake> {
    return this.mutate((data) => {
      const take = data.takes.find((item) => item.id === takeId)
      if (!take) throw new Error('Recording take not found')
      const validated = RecordingTakeSchema.parse({ ...take, offsetSeconds })
      Object.assign(take, validated)
      const project = data.projects.find((item) => item.id === take.projectId)
      if (project) project.updatedAt = new Date().toISOString()
      return take
    })
  }

  async updateTakeGain(takeId: string, gainDb: number): Promise<RecordingTake> {
    return this.mutate((data) => {
      const take = data.takes.find((item) => item.id === takeId)
      if (!take) throw new Error('Recording take not found')
      Object.assign(take, RecordingTakeSchema.parse({ ...take, gainDb }))
      const project = data.projects.find((item) => item.id === take.projectId)
      if (project) project.updatedAt = new Date().toISOString()
      return take
    })
  }

  async setLastExport(projectId: string, outputPath: string): Promise<void> {
    await this.mutate((data) => {
      const project = data.projects.find((item) => item.id === projectId)
      if (!project) throw new Error('Project not found')
      project.lastExportPath = outputPath
      project.updatedAt = new Date().toISOString()
    })
  }
}
