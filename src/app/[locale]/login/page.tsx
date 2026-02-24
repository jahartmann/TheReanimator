"use client";

import { APP_VERSION } from '@/lib/constants';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { login, changePassword, getCurrentUser } from '@/lib/actions/userAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Lock, User, Key, AlertCircle, Shield, Zap, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function LoginPage() {
    const t = useTranslations('login');
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Password change state
    const [showPasswordChange, setShowPasswordChange] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Password visibility state
    const [showPassword, setShowPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Check if already logged in
    useEffect(() => {
        getCurrentUser().then(user => {
            if (user && !user.force_password_change) {
                router.replace('/');
            }
        });
    }, [router]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login(username, password);

            if (result.success) {
                if (result.requiresPasswordChange) {
                    setShowPasswordChange(true);
                    setCurrentPassword(password);
                } else {
                    router.replace('/');
                }
            } else {
                setError(result.error || t('loginFailed'));
            }
        } catch (e) {
            console.error('[Login] Exception:', e);
            setError(t('errorOccurred') + ': ' + String(e));
        } finally {
            setLoading(false);
        }
    }

    async function handlePasswordChange(e: React.FormEvent) {
        e.preventDefault();
        setError('');

        if (newPassword !== confirmPassword) {
            setError(t('passwordMismatch'));
            return;
        }

        if (newPassword.length < 6) {
            setError(t('passwordTooShort'));
            return;
        }

        setLoading(true);

        try {
            const result = await changePassword(currentPassword, newPassword);

            if (result.success) {
                router.replace('/');
            } else {
                setError(result.error || t('errorOccurred'));
            }
        } catch (e) {
            setError(t('errorOccurred'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex">
            {/* Left Side - Branding */}
            <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
                {/* Decorative Elements */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/20 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
                <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />

                {/* Grid Pattern */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

                <div className="relative z-10 flex flex-col justify-center px-12 text-white">
                    <div className="space-y-8">
                        {/* Logo */}
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                                <Zap className="h-8 w-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-4xl font-bold tracking-tight">Reanimator</h1>
                                <p className="text-slate-400 text-sm">{t('title')}</p>
                            </div>
                        </div>

                        {/* Features */}
                        <div className="space-y-6 pt-8">
                            <div className="flex items-start gap-4">
                                <div className="h-10 w-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                    <Shield className="h-5 w-5 text-emerald-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">{t('safeBackups')}</h3>
                                    <p className="text-sm text-slate-400">{t('safeBackupsDesc')}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="h-10 w-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                    <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold">{t('clusterMigration')}</h3>
                                    <p className="text-sm text-slate-400">{t('clusterMigrationDesc')}</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="h-10 w-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                    <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold">{t('centralizedOverview')}</h3>
                                    <p className="text-sm text-slate-400">{t('centralizedOverviewDesc')}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="absolute bottom-8 left-12 text-sm text-slate-500">
                        © 2026 Reanimator • v1.0.0
                    </div>
                </div>
            </div>

            {/* Right Side - Login Form */}
            <div className="flex-1 flex items-center justify-center p-8 bg-background relative">
                {/* Language Switcher */}
                <div className="absolute top-6 right-6">
                    <LanguageSwitcher />
                </div>

                <div className="w-full max-w-md space-y-8">
                    {/* Mobile Logo */}
                    <div className="lg:hidden text-center space-y-2">
                        <div className="inline-flex h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 items-center justify-center shadow-lg shadow-emerald-500/30">
                            <Zap className="h-8 w-8 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold">Reanimator</h1>
                        <p className="text-sm text-muted-foreground">{t('title')}</p>
                    </div>

                    <div className="space-y-2 text-center lg:text-left">
                        <h2 className="text-2xl font-bold tracking-tight">
                            {showPasswordChange ? t('passwordChange') : t('title')}
                        </h2>
                        <p className="text-xs text-muted-foreground mt-4">
                            © 2026 Reanimator • {APP_VERSION}
                        </p>
                        <p className="text-muted-foreground">
                            {showPasswordChange
                                ? t('newPassword')
                                : t('username')
                            }
                        </p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                            <AlertCircle className="h-5 w-5 shrink-0" />
                            <span className="text-sm">{error}</span>
                        </div>
                    )}

                    {!showPasswordChange ? (
                        <form onSubmit={handleLogin} className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-medium">{t('username')}</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="username"
                                        type="text"
                                        placeholder={t('username')}
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="pl-10 h-11"
                                        required
                                        autoComplete="username"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-sm font-medium">{t('password')}</Label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pl-10 pr-10 h-11"
                                        required
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t('login')}
                            </Button>
                        </form>
                    ) : (
                        <form onSubmit={handlePasswordChange} className="space-y-5">
                            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                                <p className="text-sm">
                                    <strong>{t('passwordChange')}:</strong> {t('newPassword')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="newPassword" className="text-sm font-medium">{t('newPassword')}</Label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="newPassword"
                                        type={showNewPassword ? "text" : "password"}
                                        placeholder="******"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="pl-10 pr-10 h-11"
                                        required
                                        minLength={6}
                                        autoComplete="new-password"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword" className="text-sm font-medium">{t('confirmPassword')}</Label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="confirmPassword"
                                        type={showConfirmPassword ? "text" : "password"}
                                        placeholder="******"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="pl-10 pr-10 h-11"
                                        required
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t('confirmPassword')}
                            </Button>
                        </form>
                    )}

                    <p className="text-xs text-center text-muted-foreground pt-4">
                        Protected by session authentication
                    </p>
                </div>
            </div>
        </div>
    );
}
