import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { usersApi } from '@/api/users'
import { UserRank } from '@/types/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_auth/manage/users')({
  beforeLoad: () => {
    if ((useAuthStore.getState().user?.rank ?? 0) < UserRank.Officer) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ManageUsersPage,
})

const ALL_RANKS = [UserRank.Guest, UserRank.Member, UserRank.Officer, UserRank.Colonel, UserRank.Leader]

/**
 * Ранги образуют строгую лестницу: править можно только тех, кто ниже тебя, и
 * поднимать не выше ступени под собой — офицер до участника, полковник до
 * офицера, лидер до полковника. Равный ранг недоступен в обе стороны, и это же
 * закрывает собственную строку. Те же два правила проверяет сервер, здесь они
 * лишь убирают из интерфейса заведомо отказные действия.
 */
function canManage(targetRank: number, currentRank: number | undefined): boolean {
  return targetRank < (currentRank ?? 0)
}

const RANK_CLASSES: Record<number, string> = {
  [UserRank.Guest]: 'bg-secondary text-muted-foreground border-border',
  [UserRank.Member]: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  [UserRank.Officer]: 'bg-accent/10 text-accent border-accent/30',
  [UserRank.Colonel]: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/30',
  [UserRank.Leader]: 'bg-destructive/10 text-destructive border-destructive/30',
}

function RankCell({ user, editing, currentUser, onChange }: {
  user: { id: string; rank: number }
  editing: boolean
  currentUser: { rank: number } | null
  onChange: (rank: number) => void
}) {
  const { t } = useTranslation()
  if (!editing) {
    return (
      <Badge className={cn('border text-xs', RANK_CLASSES[user.rank])}>
        {t(`users.ranks.${user.rank}`)}
      </Badge>
    )
  }
  return (
    <Select defaultValue={user.rank.toString()} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-7 w-36 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL_RANKS
          .filter((r) => r < (currentUser?.rank ?? 0))
          .map((r) => (
            <SelectItem key={r} value={r.toString()}>
              {t(`users.ranks.${r}`)}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

function ManageUsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const [editingId, setEditingId] = useState<string | null>(null)

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
  })

  const updateRank = useMutation({
    mutationFn: ({ userId, rank }: { userId: string; rank: number }) =>
      usersApi.updateRank(userId, rank),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingId(null)
    },
  })

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-black tracking-tight text-foreground">{t('users.title')}</h1>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight text-foreground mb-6">{t('users.title')}</h1>
      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('users.username')}</TableHead>
                  <TableHead>{t('users.rank')}</TableHead>
                  <TableHead>{t('users.email')}</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-foreground">{user.username}</TableCell>
                    <TableCell>
                      <RankCell
                        user={user}
                        editing={editingId === user.id}
                        currentUser={currentUser}
                        onChange={(rank) => updateRank.mutate({ userId: user.id, rank })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{user.email ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage(user.rank, currentUser?.rank) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(editingId === user.id ? null : user.id)}
                          className="h-7 text-xs text-accent hover:text-accent hover:bg-accent/10"
                        >
                          {editingId === user.id ? t('common.cancel') : t('users.changeRank')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {users?.map((user) => (
              <div key={user.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{user.username}</span>
                  <RankCell
                    user={user}
                    editing={editingId === user.id}
                    currentUser={currentUser}
                    onChange={(rank) => updateRank.mutate({ userId: user.id, rank })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{user.email ?? '—'}</span>
                  {canManage(user.rank, currentUser?.rank) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(editingId === user.id ? null : user.id)}
                      className="h-7 text-xs text-accent hover:bg-accent/10 hover:text-accent"
                    >
                      {editingId === user.id ? t('common.cancel') : t('users.changeRank')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
