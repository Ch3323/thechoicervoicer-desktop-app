import {
  createVoiceEffect,
  tuneVoiceEffect,
  type VoiceEffect,
} from '@studio/shared'

const controls = [
  ['pitch', 'Pitch', -12, 12, 'st'],
  ['tone', 'Tone', -100, 100, ''],
  ['texture', 'Texture', 0, 100, '%'],
  ['space', 'Space', 0, 100, '%'],
  ['echo', 'Echo', 0, 100, '%'],
  ['mod', 'Mod', 0, 100, '%'],
] as const

export function VoiceEffectsPanel({
  effect,
  onChange,
}: {
  effect: VoiceEffect
  onChange: (effect: VoiceEffect) => void
}) {
  const shown = effect
  return (
    <section
      aria-label="Voice effect"
      className="rounded-xl border border-border bg-card p-4"
    >
      <h3 className="text-sm font-bold text-primary">Voice effect</h3>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Applied to playback, Watch dub, and exports
      </p>
      <label className="mt-4 block text-[10px] font-bold uppercase text-muted-foreground">
        Preset
        <select
          value={shown.preset}
          onChange={(event) =>
            onChange(
              createVoiceEffect(event.target.value as VoiceEffect['preset']),
            )
          }
          className="mt-2 w-full rounded border border-border bg-secondary px-2 py-2 text-sm text-foreground"
        >
          <option value="original">Original</option>
          <option value="deep">Deep</option>
          <option value="cartoon">Cartoon</option>
          <option value="robot">Robot</option>
          <option value="radio">Radio</option>
          <option value="echo">Echo</option>
          <option value="hall">Hall</option>
          <option value="cave">Cave</option>
          <option value="megaphone">Megaphone</option>
          <option value="alien">Alien</option>
          <option value="monster">Monster</option>
          <option value="chorus">Chorus</option>
          <option value="underwater">Underwater</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <details className="mt-3 rounded border border-border p-2" open>
        <summary className="cursor-pointer text-xs font-semibold">
          Fine tune
        </summary>
        <div className="mt-3 space-y-3">
          {controls.map(([key, label, min, max, unit]) => (
            <label
              key={key}
              className="grid grid-cols-[56px_1fr_42px] items-center gap-2 text-[10px]"
            >
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                value={shown[key]}
                onChange={(event) =>
                  onChange(
                    tuneVoiceEffect(shown, key, Number(event.target.value)),
                  )
                }
                className="w-full accent-fuchsia-500"
              />
              <span className="text-right text-fuchsia-400">
                {shown[key]}
                {unit}
              </span>
            </label>
          ))}
        </div>
      </details>
    </section>
  )
}
