export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log('Registering instrumentation hook...');
        const { initScheduler } = await import('@/lib/scheduler');
        initScheduler();
    }
}
