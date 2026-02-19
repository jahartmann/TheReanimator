/**
 * SSH Key Utilities - Server-side only
 * Isolated to avoid Turbopack build warnings on dynamic file paths
 */

import fs from 'fs';

/**
 * Read SSH private key from filesystem.
 * @param keyPath Absolute path to private key
 */
export function readPrivateKey(keyPath: string): string {
    return fs.readFileSync(keyPath, 'utf-8');
}

/**
 * Read SSH public key from filesystem.
 * @param keyPath Absolute path to public key
 */
export function readPublicKey(keyPath: string): string {
    return fs.readFileSync(keyPath, 'utf-8');
}

/**
 * Check if SSH key file exists.
 * @param keyPath Absolute path to key file
 */
export function keyExists(keyPath: string): boolean {
    return fs.existsSync(keyPath);
}
