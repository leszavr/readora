// Простейший in-memory presence-трекинг пользователей онлайн.
// Один Node-контейнер в production, поэтому Map вместо таблицы в БД.
// Каждая авторизованная активность (requireAuth) обновляет lastSeenAt.

export interface OnlineUser {
  id: number;
  username: string;
  role: string;
  lastSeenAt: number;
}

const ONLINE_TTL_MS = 5 * 60 * 1000;

const onlineUsers = new Map<number, OnlineUser>();

function pruneExpired(now = Date.now()): void {
  for (const [id, entry] of onlineUsers) {
    if (now - entry.lastSeenAt > ONLINE_TTL_MS) onlineUsers.delete(id);
  }
}

export function touchOnlineUser(user: { id: number; username: string; role: string }): void {
  onlineUsers.set(user.id, { ...user, lastSeenAt: Date.now() });
}

export function getOnlineUsers(): OnlineUser[] {
  pruneExpired();
  return [...onlineUsers.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function getOnlineUsersCount(): number {
  pruneExpired();
  return onlineUsers.size;
}
