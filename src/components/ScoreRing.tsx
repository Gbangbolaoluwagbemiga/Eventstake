interface ScoreRingProps {
  score: number
  label: string
  size?: number
}

const LABEL_COLORS: Record<string, string> = {
  trusted: 'var(--success)',
  building: '#1061a6',
  'at risk': '#c97800',
  low: 'var(--danger)',
  new: 'var(--subtle)',
}

export default function ScoreRing({ score, label, size = 120 }: ScoreRingProps) {
  const radius = (size - 20) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (score / 100) * circumference
  const gap = circumference - progress
  const color = LABEL_COLORS[label] ?? 'var(--accent)'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={10}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${gap}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ gap: 2 }}
      >
        <span
          className="display font-bold"
          style={{ fontSize: size * 0.26, color: 'var(--ink)', lineHeight: 1 }}
        >
          {score}
        </span>
        <span
          className="text-xs font-semibold uppercase"
          style={{ fontSize: size * 0.09, color, letterSpacing: '0.06em' }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}
