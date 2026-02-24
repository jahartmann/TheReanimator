/**
 * TypeScript → JavaScript compiler for custom tools.
 * Uses esbuild for fast, zero-config compilation.
 */

import { analyzeToolSafety, type SafetyLevel } from './safety';

export interface CompilationResult {
    success: boolean;
    compiledCode?: string;
    safetyLevel: SafetyLevel;
    safetyIssues: string[];
    error?: string;
}

/**
 * Compile and validate custom tool code.
 * Uses dynamic import of esbuild (optional dependency).
 */
export async function compileToolCode(code: string): Promise<CompilationResult> {
    // 1. Safety analysis first
    const safety = analyzeToolSafety(code);
    if (safety.level === 'dangerous') {
        return {
            success: false,
            safetyLevel: 'dangerous',
            safetyIssues: safety.issues,
            error: `Code enthält verbotene Muster: ${safety.blockedPatterns.join(', ')}`,
        };
    }

    // 2. Try to compile with esbuild
    try {
        // @ts-ignore - esbuild is an optional dependency
        const esbuild = await import('esbuild');
        const result = await esbuild.transform(code, {
            loader: 'ts',
            target: 'es2022',
            format: 'cjs',
            minify: false,
        });

        return {
            success: true,
            compiledCode: result.code,
            safetyLevel: safety.level,
            safetyIssues: safety.issues,
        };
    } catch (esbuildError: any) {
        // Fallback: if esbuild is not available, try simple validation
        try {
            // Basic syntax check - try to parse as a function
            new Function(code);
            return {
                success: true,
                compiledCode: code, // Use as-is (assume JS)
                safetyLevel: safety.level,
                safetyIssues: safety.issues,
            };
        } catch (syntaxError: any) {
            return {
                success: false,
                safetyLevel: safety.level,
                safetyIssues: safety.issues,
                error: `Kompilierungsfehler: ${syntaxError.message}`,
            };
        }
    }
}

/**
 * Validate tool parameter schema.
 */
export function validateParameterSchema(schema: Record<string, any>): { valid: boolean; error?: string } {
    if (typeof schema !== 'object') {
        return { valid: false, error: 'Schema muss ein Objekt sein.' };
    }

    // Check for basic JSON Schema structure
    if (schema.type && schema.type !== 'object') {
        return { valid: false, error: 'Wurzel-Schema muss type: "object" haben.' };
    }

    return { valid: true };
}
