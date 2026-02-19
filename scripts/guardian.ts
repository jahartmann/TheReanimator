import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    checkIntervalMs: 10000,
    healthEndpoint: 'http://localhost:3000/api/health',
    maxFailuresBeforeAction: 3,
    dbPath: path.resolve(__dirname, '../data/proxhost.db'),
    logFile: path.resolve(__dirname, '../guardian.log')
};

enum SystemStatus {
    HEALTHY,
    DEGRADED,
    CRITICAL
}

class Guardian {
    private failureCount = 0;

    constructor() {
        console.log("🛡️  Guardian Core Online. Monitoring Reanimator...");
        this.log("Guardian started.");
    }

    async start() {
        setInterval(() => this.checkSystem(), CONFIG.checkIntervalMs);
        this.checkSystem(); // Initial check
    }

    private log(message: string) {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${message}`;
        console.log(line);
        fs.appendFileSync(CONFIG.logFile, line + '\n');
    }

    private async checkSystem() {
        try {
            // 1. Check HTTP Health
            const health = await this.checkHttpHealth();

            if (health.status === 'ok') {
                if (this.failureCount > 0) {
                    this.log("✅ System recovered.");
                    this.failureCount = 0;
                }
                // Optional: Check DB latency from health response
                if (health.db_latency_ms > 1000) {
                    console.warn(`⚠️  High DB Latency: ${health.db_latency_ms}ms`);
                }
                return;
            } else {
                throw new Error(`Health API returned error: ${health.message}`);
            }

        } catch (error: any) {
            this.failureCount++;
            this.log(`❌ System Check Failed (${this.failureCount}/${CONFIG.maxFailuresBeforeAction}): ${error.message}`);

            if (this.failureCount >= CONFIG.maxFailuresBeforeAction) {
                await this.performSelfRepair();
            }
        }
    }

    private async checkHttpHealth(): Promise<any> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const res = await fetch(CONFIG.healthEndpoint, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e: any) {
            clearTimeout(timeoutId);
            throw e;
        }
    }

    private async performSelfRepair() {
        this.log("⚠️  INITIATING SELF-REPAIR PROTOCOLS...");

        // Strategy 1: Check Database Integrity
        const dbExists = fs.existsSync(CONFIG.dbPath);
        if (!dbExists) {
            this.log("🚨 Fatal: Database missing. Attempting migration...");
            await this.runCommand('npm run migrate');
            this.failureCount = 0; // Reset to give it time to recover
            return;
        }

        // Strategy 2: If DB exists but app is failing, might be a schema mismatch or lock
        this.log("🔧 Attempting Database Migration (Fix Schema)...");
        try {
            await this.runCommand('npm run migrate');
            this.log("✅ Migration command executed.");
        } catch (e) {
            this.log("❌ Migration failed.");
        }

        // Strategy 3: Cache Clearing (Nuclear Option)
        // this.log("🧹 Clearing Next.js Cache...");
        // try {
        //     fs.rmSync(path.resolve(__dirname, '../.next/cache'), { recursive: true, force: true });
        // } catch (e) { console.error("Cache clear error", e); }

        // Strategy 4: Suggest Restart
        // We cannot easily restart the parent process unless we use PM2 interaction
        this.log("🤖 AI Diagnosis: System unstable. Recommended Action: Restart Service.");
        // Try PM2 restart if available
        try {
            await this.runCommand('pm2 restart reanimator');
            this.log("✅ PM2 Restart command sent.");
        } catch {
            this.log("ℹ️  PM2 not detected or failed. Manual restart required.");
        }

        // Back off to avoid loops
        this.failureCount = 0;
    }

    private async runCommand(cmd: string) {
        try {
            const { stdout, stderr } = await execAsync(cmd, { cwd: path.resolve(__dirname, '..') });
            if (stdout) this.log(`CMD OUT: ${stdout.trim()}`);
            if (stderr) this.log(`CMD ERR: ${stderr.trim()}`);
        } catch (e: any) {
            this.log(`CMD FAIL: ${e.message}`);
            throw e;
        }
    }
}

// Start
new Guardian().start();
