import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { UserRank } from '@/types/api'

const rankNames: Record<number, string> = {
  [UserRank.Guest]: 'Guest',
  [UserRank.Member]: 'Member',
  [UserRank.Officer]: 'Officer',
  [UserRank.Colonel]: 'Colonel',
  [UserRank.Leader]: 'Leader',
}

export function Navbar() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  function handleLogout() {
    logout()
    void navigate({ to: '/login' })
  }

  const canManageUsers = (user?.rank ?? 0) >= UserRank.Officer

  const navLinks = [
    { to: '/dashboard' as const, label: t('nav.dashboard') },
    { to: '/squads' as const, label: t('nav.squads') },
    { to: '/tickets' as const, label: t('nav.tickets') },
    { to: '/settings' as const, label: t('nav.settings') },
  ]

  return (
    <nav className="bg-bg-card border-b border-border">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        {/* Left: brand */}
        <Link to="/" className="text-accent font-bold text-xl">
          Awake
        </Link>

        {/* Center: nav links (desktop) */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-text-muted hover:text-text-primary transition-colors"
              activeProps={{ className: 'text-accent hover:text-accent' }}
            >
              {link.label}
            </Link>
          ))}
          {canManageUsers && (
            <Link
              to="/manage/users"
              className="text-text-muted hover:text-text-primary transition-colors"
              activeProps={{ className: 'text-accent hover:text-accent' }}
            >
              {t('nav.manage')}
            </Link>
          )}
        </div>

        {/* Right: user info + logout */}
        <div className="hidden md:flex items-center gap-3">
          {user && (
            <>
              <span className="text-text-primary text-sm">{user.username}</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium text-accent bg-accent-tint">
                {rankNames[user.rank]}
              </span>
            </>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            {t('nav.logout')}
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-text-muted hover:text-text-primary"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span className="text-xl">{menuOpen ? '✕' : '☰'}</span>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border px-4 py-3 flex flex-col gap-3">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-text-muted hover:text-text-primary transition-colors"
              activeProps={{ className: 'text-accent hover:text-accent' }}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          {canManageUsers && (
            <Link
              to="/manage/users"
              className="text-text-muted hover:text-text-primary transition-colors"
              activeProps={{ className: 'text-accent hover:text-accent' }}
              onClick={() => setMenuOpen(false)}
            >
              {t('nav.manage')}
            </Link>
          )}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            {user && (
              <>
                <span className="text-text-primary text-sm">{user.username}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium text-accent bg-accent-tint">
                  {rankNames[user.rank]}
                </span>
              </>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
