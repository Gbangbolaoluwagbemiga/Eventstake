import { NavLink, useLocation } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Home, Calendar, Ticket, Star, Droplets } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'Home', exact: true },
  { to: '/events', icon: Calendar, label: 'Events', exact: false },
  { to: '/my/events', icon: Ticket, label: 'My Events', exact: false },
  { to: '/my/record', icon: Star, label: 'Record', exact: false },
  { to: '/pool', icon: Droplets, label: 'Pool', exact: false },
]

export default function NavBar() {
  const location = useLocation()

  return (
    <>
      {/* Top bar */}
      <header
        className="sticky top-0 z-50 px-4 py-3"
        style={{
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <NavLink to="/" className="flex flex-col leading-tight" style={{ textDecoration: 'none' }}>
            <span className="display text-lg font-bold" style={{ color: 'var(--ink)', fontWeight: 700, letterSpacing: '-0.03em' }}>
              EventStake
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              USDC stake-to-attend on Arc
            </span>
          </NavLink>
          <ConnectKitButton />
        </div>
      </header>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-stretch justify-around max-w-lg mx-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => {
            const isActive = exact
              ? location.pathname === to
              : location.pathname.startsWith(to) && (to !== '/' || location.pathname === '/')
            return (
              <NavLink
                key={to}
                to={to}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2"
                style={{
                  textDecoration: 'none',
                  color: isActive ? 'var(--accent)' : 'var(--subtle)',
                  minHeight: '56px',
                  transition: 'color 0.15s',
                }}
              >
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  style={{ color: isActive ? 'var(--accent)' : 'var(--subtle)' }}
                />
                <span
                  className="text-xs font-medium"
                  style={{
                    fontSize: '10px',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? 'var(--accent)' : 'var(--subtle)',
                  }}
                >
                  {label}
                </span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </>
  )
}
