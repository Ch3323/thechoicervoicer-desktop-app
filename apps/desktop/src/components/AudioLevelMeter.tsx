const TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60]

export function AudioLevelMeter({ levelDb }: { levelDb: number }) {
  const level = Number.isFinite(levelDb)
    ? Math.max(-60, Math.min(0, levelDb))
    : -60
  return (
    <div
      aria-label={`Session voice level ${Math.round(level)} dBFS`}
      className="flex w-16 shrink-0 flex-col items-center px-1 py-2 text-[10px] text-muted-foreground"
    >
      <span className="mb-2 font-bold uppercase tracking-wider text-primary">
        dB
      </span>
      <div className="flex min-h-40 w-full flex-1 justify-center gap-0.5">
        <div className="relative w-5 overflow-hidden border border-border bg-black">
          <div
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary via-amber-400 to-red-500 transition-[height] duration-75"
            style={{ height: `${((level + 60) / 60) * 100}%` }}
          />
        </div>
        <div className="flex flex-col justify-between text-right tabular-nums">
          {TICKS.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
