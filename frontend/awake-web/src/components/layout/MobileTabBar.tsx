import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Settings,
  Shield,
  UserCircle,
  Users,
  Zap,
  Box,
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { UserRank } from '@/types/api'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MEMBER_PLUS_TABS = [
  { to: '/dashboard' as const, label: 'Дашборд', icon: LayoutDashboard },
  { to: '/squads' as const, label: 'Отряды', icon: Shield },
]
const BASE_TABS = [
  { to: '/tickets' as const, label: 'Тикеты', icon: FileText },
  { to: '/profile' as const, label: 'Профиль', icon: UserCircle },
]

const RANK_CLASSES: Record<number, string> = {
  [UserRank.Guest]: 'bg-secondary text-muted-foreground border-border',
  [UserRank.Member]: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  [UserRank.Officer]: 'bg-accent/10 text-accent border-accent/30',
  [UserRank.Colonel]: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
  [UserRank.Leader]: 'bg-destructive/10 text-destructive border-destructive/30',
}

// Нижняя навигация на мобиле (<md): 4 таба + «Ещё» с листом
// (настройки, управление по рангу, уведомления, выход)
export function MobileTabBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname = useRouterState().location.pathname

  const rank = user?.rank ?? 0
  const isMemberPlus = rank >= UserRank.Member
  const isColonelPlus = rank >= UserRank.Colonel
  const tabs = isMemberPlus ? [...MEMBER_PLUS_TABS, ...BASE_TABS] : BASE_TABS

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/')
  }

  function handleLogout() {
    logout()
    setMoreOpen(false)
    void navigate({ to: '/login' })
  }

  return (
    <div className="md:hidden">
      {/* Лист «Ещё» */}
      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-16 rounded-t-xl border-t border-border bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {user?.username}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <NotificationBell direction="up" />
                <Badge className={cn('h-5 border px-1.5 py-0 text-[10px]', RANK_CLASSES[user?.rank ?? 0])}>
                  {t(`users.ranks.${user?.rank ?? 0}`)}
                </Badge>
              </div>
            </div>
            <nav className="space-y-1">
              {isMemberPlus && (
                <Link
                  to="/boosts"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Zap size={16} />
                  {t('nav.boosts')}
                </Link>
              )}
              {isMemberPlus && (
                <Link
                  to="/world"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Box size={16} />
                  {t('nav.world')}
                </Link>
              )}
              <Link
                to="/settings"
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Settings size={16} />
                {t('nav.settings')}
              </Link>
              {isColonelPlus && (
                <Link
                  to="/manage/users"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Users size={16} />
                  {t('nav.manage')}
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full justify-start gap-3 px-3 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut size={16} />
                {t('nav.logout')}
              </Button>
            </nav>
          </div>
        </div>
      )}

      {/* Панель */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-16 border-t border-border bg-card/95 backdrop-blur-md">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            onClick={() => setMoreOpen(false)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
              isActive(tab.to) ? 'text-accent' : 'text-muted-foreground',
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
            moreOpen ? 'text-accent' : 'text-muted-foreground',
          )}
        >
          <MoreHorizontal size={18} />
          Ещё
        </button>
      </nav>
    </div>
  )
}
