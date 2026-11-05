/** Magura mark: the M with an orbit ring and a moon. Drawn back-ring → M → front-ring so the orbit wraps the letter. */
export function LogoMark({ size = 32, color = '#F2F4F3', accent = '#2FE39A' }: { size?: number; color?: string; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Magura">
      <g transform="rotate(-14 60 66)">
        <path d="M10 70 A50 15 0 0 1 110 70" fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity="0.9" />
      </g>
      <path d="M30 96 V26 H44 L60 52 L76 26 H90 V96 H78 V48 L60 76 L42 48 V96 Z" fill={color} />
      <g transform="rotate(-14 60 66)">
        <path d="M110 70 A50 15 0 0 1 10 70" fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" />
      </g>
      <circle cx="106" cy="46" r="6" fill={accent} />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={compact ? 30 : 36} />
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-semibold tracking-[0.16em]">MAGURA</span>
        {!compact && <span className="num mt-1 text-[8.5px] tracking-[0.28em] text-lime">FIND.TRADE.REPEAT</span>}
      </span>
    </span>
  );
}
