console.log('[System] Instrumentation file loaded');

export async function register() {
    console.log('[System] Registering instrumentation hook...');
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
        const { initScheduler } = await import('@/lib/scheduler');
        initScheduler();

        // Initialize Telegram Bot
        const { initTelegramBot } = await import('@/lib/agent/telegram');
        initTelegramBot();

        // Initialize Hearth (Heartbeat)
        const { startHeartbeat } = await import('@/lib/agent/hearth');
        startHeartbeat();

        // Initialize Autonomous Scheduler (OpenClaw-style loop)
        const { initAutonomousScheduler } = await import('@/lib/autonomous/scheduler');
        initAutonomousScheduler();

        // Load custom tools
        try {
            const { loadActiveTools } = await import('@/lib/agent/dynamic-tools/registry');
            const count = loadActiveTools();
            if (count > 0) console.log(`[Startup] Loaded ${count} custom tools`);
        } catch (e) {
            // Custom tools are optional
        }

        // Console WebSocket Proxy — disabled (now handled by server.js)
        // To use the standalone proxy as fallback, uncomment:
        // try {
        //     const { startConsoleProxy } = await import('@/lib/console-proxy');
        //     startConsoleProxy(3001);
        // } catch (e) {
        //     console.error('[Startup] Failed to start console proxy:', e);
        // }

        // Graceful shutdown: destroy SSH pool on process termination
        const shutdownHandler = async () => {
            console.log('[System] Graceful shutdown: destroying SSH pool...');
            try {
                const { sshPool } = await import('@/lib/ssh-pool');
                sshPool.destroyAll();
            } catch {}
            process.exit(0);
        };
        process.on('SIGTERM', shutdownHandler);
        process.on('SIGINT', shutdownHandler);
    }
}
