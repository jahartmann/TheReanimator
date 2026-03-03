/**
 * Safety system for custom tools - Sandbox, blacklist, classification.
 */

// Forbidden module imports and function calls
const BLACKLISTED_PATTERNS = [
    // File system access
    /require\s*\(\s*['"]fs['"]\s*\)/,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /require\s*\(\s*['"]cluster['"]\s*\)/,
    /require\s*\(\s*['"]worker_threads['"]\s*\)/,
    /import\s+.*from\s+['"]fs['"]/,
    /import\s+.*from\s+['"]child_process['"]/,
    // Process manipulation
    /process\.exit/,
    /process\.kill/,
    /process\.env/,
    // Dangerous globals
    /eval\s*\(/,
    /\(0,\s*eval\)/,          // indirect eval: (0, eval)(...)
    /Function\s*\(/,
    /global\./,
    /globalThis\./,
    /globalThis\[/,           // bracket notation access: globalThis["eval"]
    // Dynamic imports
    /import\s*\(/,            // dynamic import: await import('fs')
    // Template literal bypasses
    /`[^`]*\$\{[^}]*\b(eval|Function|require|import)\b[^}]*\}[^`]*`/,
    // Network without explicit approval
    /require\s*\(\s*['"]net['"]\s*\)/,
    /require\s*\(\s*['"]dgram['"]\s*\)/,
    /require\s*\(\s*['"]tls['"]\s*\)/,
];

// Patterns that require review but aren't auto-rejected
const REVIEW_PATTERNS = [
    /fetch\s*\(/,
    /require\s*\(\s*['"]https?['"]\s*\)/,
    /import\s+.*from\s+['"]https?['"]/,
    /setTimeout|setInterval/,
    /Promise/,
    /async\s+function/,
];

export type SafetyLevel = 'safe' | 'review_required' | 'dangerous';

export interface SafetyAnalysis {
    level: SafetyLevel;
    issues: string[];
    blockedPatterns: string[];
}

/**
 * Analyze tool code for safety issues.
 */
export function analyzeToolSafety(code: string): SafetyAnalysis {
    const issues: string[] = [];
    const blockedPatterns: string[] = [];

    // Check blacklisted patterns
    for (const pattern of BLACKLISTED_PATTERNS) {
        if (pattern.test(code)) {
            blockedPatterns.push(pattern.source);
        }
    }

    if (blockedPatterns.length > 0) {
        return {
            level: 'dangerous',
            issues: [`Verbotene Muster gefunden: ${blockedPatterns.join(', ')}`],
            blockedPatterns,
        };
    }

    // Check review-required patterns
    const reviewNeeded: string[] = [];
    for (const pattern of REVIEW_PATTERNS) {
        if (pattern.test(code)) {
            reviewNeeded.push(pattern.source);
        }
    }

    if (reviewNeeded.length > 0) {
        return {
            level: 'review_required',
            issues: [`Prüfung empfohlen für: ${reviewNeeded.join(', ')}`],
            blockedPatterns: [],
        };
    }

    return { level: 'safe', issues: [], blockedPatterns: [] };
}

/**
 * Create a sandboxed execution context for custom tools.
 * Uses a limited scope with only approved dependencies.
 */
export function createSandboxContext() {
    return {
        // Approved built-ins
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        // Console for logging
        console: {
            log: (...args: any[]) => console.log('[CustomTool]', ...args),
            error: (...args: any[]) => console.error('[CustomTool]', ...args),
            warn: (...args: any[]) => console.warn('[CustomTool]', ...args),
        },
        // Controlled fetch for HTTP calls
        fetch: globalThis.fetch,
    };
}
