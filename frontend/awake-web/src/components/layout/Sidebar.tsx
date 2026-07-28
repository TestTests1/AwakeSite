import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { UserRank } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Shield,
  FileText,
  Settings,
  Users,
  UserCircle,
  LogOut,
  ChevronRight,
  Zap,
  Box,
} from 'lucide-react'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { BrandMark } from '@/components/BrandMark'

const RANK_CLASSES: Record<number, string> = {
  [UserRank.Guest]: 'bg-secondary text-muted-foreground border-border',
  [UserRank.Member]: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  [UserRank.Officer]: 'bg-accent/10 text-accent border-accent/30',
  [UserRank.Colonel]: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
  [UserRank.Leader]: 'bg-destructive/10 text-destructive border-destructive/30',
}

export function Sidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const rank = user?.rank ?? 0
  const isMemberPlus = rank >= UserRank.Member
  const isColonelPlus = rank >= UserRank.Colonel

  const navLinks = [
    ...(isMemberPlus ? [{ to: '/dashboard' as const, label: t('nav.dashboard'), icon: LayoutDashboard }] : []),
    { to: '/profile' as const, label: 'Профиль', icon: UserCircle },
    ...(isMemberPlus ? [{ to: '/squads' as const, label: t('nav.squads'), icon: Shield }] : []),
    ...(isMemberPlus ? [{ to: '/boosts' as const, label: t('nav.boosts'), icon: Zap }] : []),
    ...(isMemberPlus ? [{ to: '/world' as const, label: t('nav.world'), icon: Box }] : []),
    { to: '/tickets' as const, label: t('nav.tickets'), icon: FileText },
  ]

  function handleLogout() {
    logout()
    void navigate({ to: '/login' })
  }

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/')
  }

  const NavLink = ({ to, label, icon: Icon }: { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }) => (
    <Link
      to={to as '/dashboard'}
      className={cn(
        'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200',
        isActive(to)
          ? 'bg-accent/10 text-accent before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      <Icon size={16} className={isActive(to) ? 'text-accent' : 'text-muted-foreground'} />
      {label}
      {isActive(to) && <ChevronRight size={13} className="ml-auto opacity-60" />}
    </Link>
  )

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-5">
        <BrandMark />
        <p className="mt-1 pl-[18px] text-xs text-muted-foreground">STALCRAFT</p>
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navLinks.map((link) => (
          <NavLink key={link.to} {...link} />
        ))}

        {isColonelPlus && (
          <>
            <div className="py-2"><Separator /></div>
            <NavLink to="/manage/users" label={t('nav.manage')} icon={Users} />
          </>
        )}
      </nav>

      <Separator />

      {/* User section */}
      <div className="p-2 space-y-1">
        <Link
          to="/settings"
          className={cn(
            'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200',
            isActive('/settings')
              ? 'bg-accent/10 text-accent before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <Settings size={16} />
          {t('nav.settings')}
        </Link>

        <div className="mx-1 p-3 rounded-md bg-secondary border border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground truncate">{user?.username}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <NotificationBell />
              <Badge className={cn('text-[10px] px-1.5 py-0 h-5 border', RANK_CLASSES[user?.rank ?? 0])}>
                {t(`users.ranks.${user?.rank ?? 0}`)}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start h-7 px-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5"
          >
            <LogOut size={12} />
            {t('nav.logout')}
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <aside className="sticky top-0 hidden h-screen min-h-screen w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <SidebarContent />
    </aside>
  )
}
