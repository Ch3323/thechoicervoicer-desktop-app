export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${checked ? 'border-primary bg-primary' : 'border-border bg-secondary'}`}
    >
      <span
        className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-transform ${checked ? 'left-[17px]' : 'left-0.5'}`}
      />
    </button>
  )
}
