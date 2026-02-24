/**
 * Robust Tool Call Parser - Handles various formats and edge cases.
 * Replaces the simple regex approach with multi-strategy parsing.
 */

export interface ParsedToolCall {
    toolName: string;
    args: Record<string, any>;
    raw: string;
    startIndex: number;
    endIndex: number;
}

/**
 * Parse all tool calls from an LLM response.
 * Supports the <<<TOOL:Name:{"args"}>>> format with robust JSON handling.
 */
export function parseToolCalls(content: string): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];

    // Strategy 1: Standard format <<<TOOL:Name:{...}>>>
    const standardRegex = /<<<TOOL:(\w+):([\s\S]*?)>>>/g;
    let match;

    while ((match = standardRegex.exec(content)) !== null) {
        const toolName = match[1];
        const argsStr = match[2].trim();

        try {
            const args = parseJsonRobust(argsStr);
            calls.push({
                toolName,
                args,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
            });
        } catch (e) {
            // Try to salvage - maybe JSON is broken
            const fixedArgs = attemptJsonFix(argsStr);
            if (fixedArgs !== null) {
                calls.push({
                    toolName,
                    args: fixedArgs,
                    raw: match[0],
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                });
            }
        }
    }

    return calls;
}

/**
 * Parse JSON with tolerance for common LLM mistakes.
 */
function parseJsonRobust(str: string): Record<string, any> {
    // Try standard parse first
    try {
        return JSON.parse(str);
    } catch { /* continue */ }

    // Fix common issues
    let fixed = str;

    // Fix trailing commas
    fixed = fixed.replace(/,\s*([\]}])/g, '$1');

    // Fix unquoted keys
    fixed = fixed.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');

    // Fix single quotes
    fixed = fixed.replace(/'/g, '"');

    // Try again
    try {
        return JSON.parse(fixed);
    } catch { /* continue */ }

    // Last resort: try to extract key-value pairs
    throw new Error(`Cannot parse JSON: ${str.slice(0, 100)}`);
}

/**
 * Attempt to fix broken JSON from LLM output.
 */
function attemptJsonFix(str: string): Record<string, any> | null {
    // Handle empty args
    if (!str || str === '{}' || str === '') return {};

    // Try wrapping in braces
    if (!str.startsWith('{')) {
        try {
            return JSON.parse(`{${str}}`);
        } catch { /* continue */ }
    }

    // Try fixing truncated JSON by closing brackets
    let attempt = str;
    const openBraces = (attempt.match(/\{/g) || []).length;
    const closeBraces = (attempt.match(/\}/g) || []).length;
    const openBrackets = (attempt.match(/\[/g) || []).length;
    const closeBrackets = (attempt.match(/\]/g) || []).length;

    for (let i = 0; i < openBrackets - closeBrackets; i++) attempt += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) attempt += '}';

    try {
        return JSON.parse(attempt);
    } catch { /* continue */ }

    return null;
}

/**
 * Extract the text content from a response, stripping tool calls.
 */
export function stripToolCalls(content: string): string {
    return content.replace(/<<<TOOL:\w+:[\s\S]*?>>>/g, '').trim();
}
