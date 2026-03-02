'use client';

import { getAISettings } from '@/lib/actions/ai';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Server, FolderCog, ArrowRightLeft, Tag as TagIcon, HardDrive, Users, Terminal, Activity, ListTodo, Calendar, TrendingUp, Disc, Sparkles, Wrench, HeartPulse, ShieldCheck, Shield } from 'lucide-react';
import { getCurrentUser, logout, User as UserType } from '@/lib/actions/userAuth';
import { APP_VERSION, IS_BETA } from '@/lib/constants';
import { UserNav } from './UserNav';
import { useTranslations, useLocale } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Link } from '@/i18n/routing';

// Define groups
const mainNav = [
    { key: 'dashboard', href: '/', icon: LayoutDashboard },
    { key: 'monitoring', href: '/monitoring', icon: Activity },
    { key: 'servers', href: '/servers', icon: Server },
    { key: 'agent', href: '/agent', icon: Sparkles },
];

const toolsNav = [
    { key: 'optimizer', href: '/optimizer', icon: TrendingUp },
    { key: 'migrations', href: '/migrations', icon: ArrowRightLeft },
    { key: 'library', href: '/library', icon: Disc },
    { key: 'tags', href: '/tags', icon: TagIcon },
];

const systemNav = [
    { key: 'storage', href: '/storage', icon: HardDrive },
    { key: 'configs', href: '/configs', icon: FolderCog },
    { key: 'disasterRecovery', href: '/disaster-recovery', icon: ShieldCheck },
    { key: 'jobs', href: '/jobs', icon: Calendar },
    { key: 'tasks', href: '/tasks', icon: ListTodo },
];

const agentToolsNav = [
    { key: 'agentTools', href: '/tools', icon: Wrench },
    { key: 'organs', href: '/organs', icon: HeartPulse },
];

const adminNavItems = [
    { key: 'bulkCommands', href: '/tools/bulk-command', icon: Terminal },
    { key: 'users', href: '/users', icon: Users },
    { key: 'auditLog', href: '/audit', icon: Shield },
];

export function Sidebar() {
    const pathname = usePathname();
    const [user, setUser] = useState<UserType | null>(null);
    const [aiEnabled, setAiEnabled] = useState(false);
    const t = useTranslations('nav');
    const locale = useLocale();

    useEffect(() => {
        getCurrentUser().then(setUser);
        getAISettings().then(s => setAiEnabled(s.enabled));
    }, [pathname]);

    // Remove locale prefix
    const pathnameWithoutLocale = pathname.replace(new RegExp(`^/${locale}`), '') || '/';

    if (pathnameWithoutLocale === '/login') return null;

    const renderNavLink = (item: any) => {
        if (item.key === 'optimizer' && !aiEnabled) return null;
        if (item.key === 'agent' && !aiEnabled) return null;

        const isActive = pathnameWithoutLocale === item.href || (item.href !== '/' && pathnameWithoutLocale.startsWith(item.href + '/'));

        return (
            <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-300 mb-1 group relative overflow-hidden ${isActive
                    ? 'text-sidebar-primary-foreground bg-sidebar-primary/10 font-medium shadow-[0_0_15px_-5px_var(--sidebar-primary)] border border-sidebar-primary/10'
                    : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                    }`}
            >
                {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-sidebar-primary shadow-[0_0_10px_2px_var(--sidebar-primary)]"></div>
                )}
                <item.icon className={`h-4 w-4 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-sidebar-primary' : 'opacity-70 group-hover:text-sidebar-foreground '}`} />
                <span className="relative z-10">{t(item.key)}</span>
            </Link>
        );
    };

    return (
        <div className="flex flex-col w-64 h-[100dvh] fixed left-0 top-0 z-50 bg-sidebar/80 backdrop-blur-2xl border-r border-sidebar-border shadow-[5px_0_30px_-5px_oklch(0_0_0/0.3)]">
            <div className="p-6 pb-4">
                {/* Header Area */}
                <div className="flex items-center gap-3 mb-1">
                    <div className="relative group">
                        <div className="absolute inset-0 bg-primary blur-md opacity-40 group-hover:opacity-70 transition-opacity rounded-lg"></div>
                        <div className="bg-sidebar-primary/10 border border-sidebar-primary/20 p-2 rounded-xl relative">
                            <Activity className="h-5 w-5 text-primary" />
                        </div>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-sidebar-foreground bg-clip-text text-transparent bg-gradient-to-r from-sidebar-foreground to-sidebar-foreground/70">
                        Reanimator
                    </span>
                    {IS_BETA && <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded-md font-mono uppercase tracking-widest">Beta</span>}
                </div>
                {/* <div className="absolute top-4 right-4">
                    <LanguageSwitcher />
                </div> */}
            </div>

            <nav className="flex-1 px-3 space-y-8 overflow-y-auto py-4 custom-scrollbar">
                {/* Main Section */}
                <div>
                    <h3 className="px-3 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40 font-bold mb-3">Main</h3>
                    <div className="space-y-1">
                        {mainNav.map(renderNavLink)}
                    </div>
                </div>

                {/* Tools Section */}
                <div>
                    <h3 className="px-3 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40 font-bold mb-3">Tools</h3>
                    <div className="space-y-1">
                        {toolsNav.map(renderNavLink)}
                    </div>
                </div>

                {/* System Section */}
                <div>
                    <h3 className="px-3 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40 font-bold mb-3">System</h3>
                    <div className="space-y-1">
                        {systemNav.map(renderNavLink)}
                    </div>
                </div>

                {/* Agent Tools Section - Only if AI enabled */}
                {aiEnabled && (
                    <div>
                        <h3 className="px-3 text-[10px] uppercase tracking-[0.2em] text-primary/60 font-bold mb-3 glow-text-sm">{t('agentTools')}</h3>
                        <div className="space-y-1">
                            {agentToolsNav.map(renderNavLink)}
                        </div>
                    </div>
                )}

                {/* Admin Section */}
                {user?.is_admin && (
                    <div>
                        <h3 className="px-3 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40 font-bold mb-3">{t('administration')}</h3>
                        <div className="space-y-1">
                            {adminNavItems.map(item => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-300 mb-1 group relative overflow-hidden ${pathnameWithoutLocale === item.href
                                        ? 'text-sidebar-primary-foreground bg-sidebar-primary/10 font-medium shadow-[0_0_15px_-5px_var(--sidebar-primary)] border border-sidebar-primary/10'
                                        : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                                        }`}
                                >
                                    {pathnameWithoutLocale === item.href && (
                                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-sidebar-primary shadow-[0_0_10px_2px_var(--sidebar-primary)]"></div>
                                    )}
                                    <item.icon className={`h-4 w-4 transition-transform duration-300 group-hover:scale-110 ${pathnameWithoutLocale === item.href ? 'text-sidebar-primary' : 'opacity-70 group-hover:text-sidebar-foreground'}`} />
                                    <span className="relative z-10">{t(item.key)}</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </nav>

            {/* User info and footer */}
            <div className="p-4 border-t border-sidebar-border bg-sidebar/50 backdrop-blur-md">
                {user && <UserNav user={user as UserType} />}

                <div className="mt-4 px-2 flex items-center justify-between text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground/80 transition-colors">
                    <span className="font-mono">v{APP_VERSION}</span>

                    <LanguageSwitcher />
                </div>
            </div>
        </div>
    );
}
