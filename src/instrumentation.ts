console.log('[System] Instrumentation file loaded');

export async function register() {
    console.log('[System] Registering instrumentation hook...');
    if (process.env.NEXT_RUNTIME === 'nodejs') {
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
    }
}
