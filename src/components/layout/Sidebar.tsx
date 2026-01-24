'use client';

import { getAISettings } from '@/app/actions/ai';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Server, FolderCog, ArrowRightLeft, Tag as TagIcon, HardDrive, Users, Terminal, Activity, ListTodo, Calendar, TrendingUp, Disc } from 'lucide-react';
import { getCurrentUser, logout, User as UserType } from '@/app/actions/userAuth';
import { APP_VERSION, IS_BETA } from '@/lib/constants';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslations } from 'next-intl';

export function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserType | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const t = useTranslations('nav');

  useEffect(() => {
    getCurrentUser().then(setUser);
    getAISettings().then(s => setAiEnabled(s.enabled));
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
  };

  // Don't show sidebar on login page
  if (pathname.endsWith('/login')) {
    return null;
  }

  // Get pathname without locale prefix
  const pathnameWithoutLocale = pathname.replace(/^\/[a-z]{2}(\/|$)/, '/');

  const navItems = [
    { key: 'dashboard', href: '/', icon: LayoutDashboard },
    { key: 'optimizer', href: '/optimizer', icon: TrendingUp },
    { key: 'servers', href: '/servers', icon: Server },
    { key: 'migrations', href: '/migrations', icon: ArrowRightLeft },
    { key: 'tasks', href: '/tasks', icon: ListTodo },
    { key: 'jobs', href: '/jobs', icon: Calendar },
    { key: 'library', href: '/library', icon: Disc },
    { key: 'tags', href: '/tags', icon: TagIcon },
    { key: 'storage', href: '/storage', icon: HardDrive },
    { key: 'configs', href: '/configs', icon: FolderCog },
  ];

  const adminNavItems = [
    { key: 'bulkCommands', href: '/tools/bulk-command', icon: Terminal },
    { key: 'users', href: '/users', icon: Users },
  ];

  // Filter nav items based on AI settings
  const filteredNavItems = navItems.filter(item => {
    if (item.key === 'optimizer' && !aiEnabled) return false;
    return true;
  });

  const isActive = (href: string) => {
    return pathnameWithoutLocale === href || pathnameWithoutLocale.startsWith(href + '/');
  };

  return (
    <div className="flex flex-col w-64 border-r border-border bg-card h-screen fixed left-0 top-0 z-30">
      <div className="p-6 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="bg-primary/10 p-2 rounded-lg">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white uppercase">Reanimator</h1>
            {IS_BETA && (
              <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full font-bold ml-[-2px] border border-amber-500/20">BETA</span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground ml-1">Proxmox Management System</p>
      </div>
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {filteredNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive(item.href)
              ? 'text-foreground bg-white/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
          >
            <item.icon className="h-4 w-4" />
            {t(item.key as any)}
          </Link>
        ))}

        {/* Admin-only items */}
        {user?.is_admin && (
          <div className="pt-2 mt-2 border-t border-border/50">
            <p className="px-4 py-2 text-xs text-muted-foreground font-medium">{t('administration')}</p>
            {adminNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive(item.href)
                  ? 'text-foreground bg-white/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  }`}
              >
                <item.icon className="h-4 w-4" />
                {t(item.key as any)}
              </Link>
            ))}
          </div>
        )}

        <div className="pt-2 mt-2 border-t border-border/50">
          {/* Additional bottom items if needed */}
        </div>
      </nav>

      {/* User info and logout */}
      <div className="p-4 border-t border-border">
        {user && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="bg-primary/20 p-1.5 rounded-full">
                <span className="text-xs font-bold text-primary">
                  {user.username.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-sm font-medium">{user.username}</span>
            </div>
            <LanguageSwitcher />
          </div>
        )}

        <div className="px-2 flex items-center justify-between text-xs text-muted-foreground opacity-60 hover:opacity-100 transition-opacity">
          <span>v{APP_VERSION}</span>
          {IS_BETA && (
            <span className="font-mono text-[10px] uppercase tracking-wider">Beta</span>
          )}
          <a
            href="https://github.com/jahartmann/TheReanimator"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
