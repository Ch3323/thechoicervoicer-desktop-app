import brandMark from '@/assets/brand-mark.svg'

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`}>
      <img className="brand-lockup-mark" src={brandMark} alt="" />
      <span className="brand-lockup-type">
        <span className="brand-lockup-kicker">THE CHOICER</span>
        <span className="brand-lockup-title">
          <strong>VOICER</strong>
          <span className="brand-lockup-edition">AT HOME</span>
        </span>
      </span>
    </span>
  )
}
