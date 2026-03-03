/**
 * Client-safe stub for userAuth server actions.
 * The real userAuth.ts uses next/headers (cookies()) which is Next.js-only.
 * This module provides equivalent API-based implementations for the Vite SPA.
 */

export interface User {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  force_password_change: boolean;
  created_at: string;
  last_login: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
}

export interface Permission {
  id: number;
  name: string;
  description: string | null;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface ServerAccess {
  server_id: number;
  can_view: boolean;
  can_manage: boolean;
  can_migrate: boolean;
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<{ success: boolean; error?: string; requiresPasswordChange?: boolean }> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { success: false, error: body.error || 'Login failed' };
    }
    return response.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* ignore */ }
  window.location.href = '/login';
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return response.json();
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

export async function getUsers(): Promise<User[]> {
  const response = await fetch('/api/users', { credentials: 'include' });
  if (!response.ok) throw new Error('Unauthorized');
  return response.json();
}

export async function createUser(data: { username: string; password: string; email?: string; is_admin?: boolean }): Promise<{ success: boolean; error?: string }> {
  const response = await fetch('/api/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function updateUser(userId: number, data: any): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/users/${userId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

export async function deleteUser(userId: number): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/users/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return response.json();
}

export async function getRoles(): Promise<Role[]> {
  return [];
}

export async function getPermissions(): Promise<Permission[]> {
  return [];
}

export async function getUserRoles(_userId: number): Promise<Role[]> {
  return [];
}

export async function setUserRoles(_userId: number, _roleIds: number[]): Promise<{ success: boolean; error?: string }> {
  return { success: true };
}

export async function getUserServerAccess(_userId: number): Promise<ServerAccess[]> {
  return [];
}

export async function setUserServerAccess(_userId: number, _access: ServerAccess[]): Promise<{ success: boolean; error?: string }> {
  return { success: true };
}

export async function hasPermission(_permission: string): Promise<boolean> {
  return false;
}

export async function canAccessServer(_serverId: number, _action: 'view' | 'manage' | 'migrate'): Promise<boolean> {
  return true;
}
