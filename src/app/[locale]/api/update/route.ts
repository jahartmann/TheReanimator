import { NextRequest, NextResponse } from 'next/server';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

// Get version info
export async function GET() {
    try {
        const projectRoot = process.cwd();

        // Read current version from package.json
        const packagePath = path.join(projectRoot, 'package.json');
        let currentVersion = 'unknown';
        try {
            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
            currentVersion = packageJson.version;
        } catch (e) { console.error('Failed to read package.json', e) }

        // Get current git commit
        let currentCommit = 'unknown';
        let updateAvailable = false;
        let remoteCommit = 'unknown';
        let commitsBehind = 0;

        try {
            const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: projectRoot });
            currentCommit = commitHash.trim().substring(0, 7);

            // Fetch latest from remote
            await execAsync('git fetch origin main', { cwd: projectRoot });

            // Check if we're behind
            const { stdout: behindCount } = await execAsync(
                'git rev-list HEAD..origin/main --count',
                { cwd: projectRoot }
            );
            commitsBehind = parseInt(behindCount.trim()) || 0;
            updateAvailable = commitsBehind > 0;

            if (updateAvailable) {
                const { stdout: remoteHash } = await execAsync(
                    'git rev-parse origin/main',
                    { cwd: projectRoot }
                );
                remoteCommit = remoteHash.trim().substring(0, 7);
            }
        } catch (e) {
            console.error('Git check failed:', e);
        }

        return NextResponse.json({
            currentVersion,
            currentCommit,
            updateAvailable,
            remoteCommit,
            commitsBehind
        });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to check version' },
            { status: 500 }
        );
    }
}

// Perform update
export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (message: string) => {
                // Sanitize output slightly to avoid JSON breakages if raw buffer
                const safeMsg = message.trim();
                if (safeMsg) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: safeMsg })}\n\n`));
                }
            };

            // Helper for spawning long-running processes without buffer limits
            const runStep = (cmd: string, args: string[], cwd: string): Promise<void> => {
                return new Promise((resolve, reject) => {
                    // Use 'npm' (without .cmd/etc) and shell: true for cross-platform ease here, 
                    // though mainly Linux expected.
                    const child = spawn(cmd, args, { cwd, shell: true });

                    child.stdout.on('data', (data) => send(data.toString()));
                    child.stderr.on('data', (data) => send(data.toString())); // Treat stderr as log output

                    child.on('error', (err) => reject(err));
                    child.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`Command ${cmd} ${args.join(' ')} failed with code ${code}`));
                    });
                });
            };

            try {
                const projectRoot = process.cwd();
                const dbPath = path.join(projectRoot, 'data/proxhost.db');
                const dbBackupPath = path.join(os.tmpdir(), `proxhost-backup-${Date.now()}.db`);

                // Check if this is just a restart
                const restartOnly = request.headers.get('X-Restart-Only') === 'true';

                if (restartOnly) {
                    send('🔄 Restart only mode (no update)...');
                } else {
                    send('🔄 Starting update process (Robust Mode)...');
                }

                // 1. Backup Database
                if (fs.existsSync(dbPath)) {
                    send('💾 Backing up database...');
                    fs.copyFileSync(dbPath, dbBackupPath);
                    send(`✅ Database backed up to ${dbBackupPath}`);
                }

                let hadLocalChanges = false;

                // 2. Git Stash (only if not restart-only)
                if (!restartOnly) {
                    send('📥 Stashing local changes...');
                    try {
                        await runStep('git', ['stash'], projectRoot);
                        hadLocalChanges = true;
                    } catch {
                        send('ℹ️ Stash skipped or failed (ignoring)');
                    }
                }

                // 3. Git Pull (only if not restart-only)
                if (!restartOnly) {
                    send('⬇️ Pulling latest changes...');
                    await runStep('git', ['pull', 'origin', 'main'], projectRoot);
                }

                // 4. Restore Stash
                if (!restartOnly && hadLocalChanges) {
                    send('♻️ Restoring local changes...');
                    try {
                        await runStep('git', ['stash', 'pop'], projectRoot);
                        send('✅ Local changes restored');
                    } catch (e: any) {
                        send(`⚠️ Failed to restore stash: ${e.message}`);
                        console.error('Stash restore failed:', e);
                    }
                }

                // 5. Restore Data
                if (fs.existsSync(dbBackupPath)) {
                    send('♻️ Restoring database...');
                    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
                    fs.copyFileSync(dbBackupPath, dbPath);
                    send('✅ Database restored');
                }

                // 6. Build (only if not restart-only)
                if (!restartOnly) {
                    send('📦 Installing dependencies...');
                    try {
                        await runStep('npm', ['install', '--include=dev'], projectRoot);
                    } catch (e: any) {
                        send('⚠️ npm install failed (Build Tools missing?). trying to proceed...');
                        console.error('Update: npm install failed', e);
                    }

                    send('🔨 Building application...');
                    await runStep('npm', ['run', 'build'], projectRoot);

                    send('✅ Build complete!');
                }

                // 7. Restart
                send('🔄 Scheduling service restart...');

                // Detached restart
                const restartCmd = 'sleep 2 && sudo systemctl restart proxhost-backup';
                const child = spawn(restartCmd, [], {
                    cwd: projectRoot,
                    shell: true,
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();

                send('✅ Restart command issued. Service will reboot in 2 seconds.');
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                send(`❌ Critical Error: ${errorMsg}`);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
            } finally {
                // Ensure stream doesn't hang forever if we missed a closure, 
                // but usually the client closes.
                // We keep it open a bit to ensure last message sends.
                setTimeout(() => {
                    try { controller.close(); } catch { }
                }, 1000);
            }
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}


