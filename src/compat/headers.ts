/**
 * Compat shim for 'next/headers'.
 * In Express context, cookies are handled by express middleware.
 * These stubs prevent import errors in server action files.
 */

// Minimal ReadonlyRequestCookies-like interface
class CookieStore {
  private _map: Map<string, string>;

  constructor(cookieHeader?: string) {
    this._map = new Map();
    if (cookieHeader) {
      cookieHeader.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        this._map.set(key, val);
      });
    }
  }

  get(name: string) {
    const value = this._map.get(name);
    return value !== undefined ? { name, value } : undefined;
  }

  getAll() {
    return Array.from(this._map.entries()).map(([name, value]) => ({ name, value }));
  }

  has(name: string) {
    return this._map.has(name);
  }
}

// Returns empty cookie store — server actions in Express get cookies via req.cookies instead
export function cookies(): CookieStore {
  return new CookieStore();
}

export function headers(): Headers {
  return new Headers();
}
