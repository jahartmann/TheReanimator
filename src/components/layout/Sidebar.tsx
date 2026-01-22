'use client';

import { getAISettings } from '@/app/actions/ai';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Server, FolderCog, Settings, ArrowRightLeft, Tag as TagIcon, HardDrive, ShieldCheck, Disc, Users, LogOut, User, Activity, ListTodo, Calendar, TrendingUp, Terminal } from 'lucide-react';
import { getCurrentUser, logout, User as UserType } from '@/app/actions/userAuth';
import { Button } from '@/components/ui/button';
import { UserNav } from './UserNav';
import { APP_VERSION, IS_BETA } from '@/lib/constants';

const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Optimizer', href: '/optimizer', icon: TrendingUp },
    { name: 'Server', href: '/servers', icon: Server },
    { name: 'Migrationen', href: '/migrations', icon: ArrowRightLeft },
    { name: 'Tasks', href: '/tasks', icon: ListTodo },
    { name: 'Zeitplan', href: '/jobs', icon: Calendar },
    { name: 'Bibliothek', href: '/library', icon: Disc },
    { name: 'Tags', href: '/tags', icon: TagIcon },
    { name: 'Speicher', href: '/storage', icon: HardDrive },
    { name: 'Konfigurationen', href: '/configs', icon: FolderCog },
];

const adminNavItems = [
    { name: 'Bulk Commands', href: '/tools/bulk-command', icon: Terminal },
    { name: 'Benutzer', href: '/users', icon: Users },
];

export function Sidebar() {
    const pathname = usePathname();
    const [user, setUser] = useState<UserType | null>(null);
    const [aiEnabled, setAiEnabled] = useState(false);

    useEffect(() => {
        getCurrentUser().then(setUser);
        getAISettings().then(s => setAiEnabled(s.enabled));
    }, [pathname]); // Re-fetch user on route change to sync after login

    const handleLogout = async () => {
        await logout();
    };

    // Don't show sidebar on login page
    if (pathname === '/login') {
        return null;
    }

    // Filter nav items based on AI settings
    const filteredNavItems = navItems.filter(item => {
        if (item.name === 'Optimizer' && !aiEnabled) return false;
        return true;
    });

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
                <p className="text-xs text-muted-foreground ml-1">Proxmox Management Suite</p>
            </div>
            <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
                {filteredNavItems.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${pathname === item.href || pathname.startsWith(item.href + '/')
                            ? 'text-foreground bg-white/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                            }`}
                    >
                        <item.icon className="h-4 w-4" />
                        {item.name}
                    </Link>
                ))}

                {/* Admin-only items */}
                {user?.is_admin && (
                    <div className="pt-2 mt-2 border-t border-border/50">
                        <p className="px-4 py-2 text-xs text-muted-foreground font-medium">Admin</p>
                        {adminNavItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors ${pathname === item.href
                                    ? 'text-foreground bg-white/10'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                    }`}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.name}
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
                {user && <UserNav user={user} />}

                <div className="mt-4 px-2 flex items-center justify-between text-xs text-muted-foreground opacity-60 hover:opacity-100 transition-opacity">
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
