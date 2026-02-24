'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Settings, LogOut, Shield } from "lucide-react";
import { User as UserType, logout } from "@/lib/actions/userAuth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from 'next-intl';

interface UserNavProps {
    user: UserType;
}

export function UserNav({ user }: UserNavProps) {
    const router = useRouter();
    const t = useTranslations('common');
    const tNav = useTranslations('nav');
    const tUsers = useTranslations('users');

    const handleLogout = async () => {
        await logout();
        // Force refresh to update server components/middleware state if needed
        router.refresh();
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-14 w-full justify-start gap-4 px-2 hover:bg-primary/5 hover:text-primary transition-all duration-300 group rounded-xl">
                    <Avatar className="h-10 w-10 border border-primary/20 shadow-sm transition-all duration-300 group-hover:border-primary/50 group-hover:shadow-md">
                        <AvatarImage src="" alt={user.username} />
                        <AvatarFallback className="bg-gradient-to-br from-primary to-blue-500 text-white font-bold shadow-inner">
                            {user.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start text-left space-y-1 overflow-hidden flex-1">
                        <span className="text-sm font-semibold leading-none truncate w-full">{user.username}</span>
                        <span className="text-xs text-muted-foreground truncate w-full">
                            {user.is_admin ? tUsers('isAdmin') : tUsers('isUser')}
                        </span>
                    </div>
                    {/* Visual indicator for dropdown */}
                    <div className="ml-auto text-muted-foreground/50">
                        <User className="h-4 w-4" />
                    </div>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 glass-card border-white/10" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-semibold tracking-tight text-gradient leading-none">{user.username}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                            {user.is_admin ? tUsers('adminRights') : tUsers('limitedRights')}
                        </p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                        <Link href="/settings" className="cursor-pointer w-full">
                            <Settings className="mr-2 h-4 w-4" />
                            {t('settings')}
                        </Link>
                    </DropdownMenuItem>
                    {user.is_admin && (
                        <DropdownMenuItem asChild>
                            <Link href="/settings/trust" className="cursor-pointer w-full">
                                <Shield className="mr-2 h-4 w-4" />
                                {tUsers('clusterTrust')}
                            </Link>
                        </DropdownMenuItem>
                    )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:bg-red-500/10 focus:text-red-600 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('logout')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
