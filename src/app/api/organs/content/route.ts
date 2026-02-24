import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Define allowed organs to prevent arbitrary file access
const ALLOWED_ORGANS: Record<string, string> = {
    'soul': 'src/lib/organs/soul/SOUL.md',
    'heart': 'src/lib/organs/heart/HEARTBEAT.md',
    'brain': 'src/lib/organs/brain/MEMORY.md',
    'user': 'src/lib/organs/brain/USER.md',
    'tools': 'src/lib/organs/hands/TOOLS.md',
};

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const organ = searchParams.get('organ');

    if (!organ || !ALLOWED_ORGANS[organ]) {
        return NextResponse.json({ error: 'Invalid organ' }, { status: 400 });
    }

    try {
        // Use a switch to help the bundler see static paths
        let filePath = '';
        switch (organ) {
            case 'soul': filePath = path.resolve(process.cwd(), 'src/lib/organs/soul/SOUL.md'); break;
            case 'heart': filePath = path.resolve(process.cwd(), 'src/lib/organs/heart/HEARTBEAT.md'); break;
            case 'brain': filePath = path.resolve(process.cwd(), 'src/lib/organs/brain/MEMORY.md'); break;
            case 'user': filePath = path.resolve(process.cwd(), 'src/lib/organs/brain/USER.md'); break;
            case 'tools': filePath = path.resolve(process.cwd(), 'src/lib/organs/hands/TOOLS.md'); break;
            default: throw new Error('Invalid organ'); // Should be caught by validation above
        }
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            // Return empty string if file doesn't exist yet
            return NextResponse.json({ content: '' });
        }

        const content = await fs.readFile(filePath, 'utf-8');
        return NextResponse.json({ content });
    } catch (error) {
        console.error('Error reading organ:', error);
        return NextResponse.json({ error: 'Failed to read organ' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { organ, content } = body;

        if (!organ || !ALLOWED_ORGANS[organ]) {
            return NextResponse.json({ error: 'Invalid organ' }, { status: 400 });
        }

        let filePath = '';
        switch (organ) {
            case 'soul': filePath = path.resolve(process.cwd(), 'src/lib/organs/soul/SOUL.md'); break;
            case 'heart': filePath = path.resolve(process.cwd(), 'src/lib/organs/heart/HEARTBEAT.md'); break;
            case 'brain': filePath = path.resolve(process.cwd(), 'src/lib/organs/brain/MEMORY.md'); break;
            case 'user': filePath = path.resolve(process.cwd(), 'src/lib/organs/brain/USER.md'); break;
            case 'tools': filePath = path.resolve(process.cwd(), 'src/lib/organs/hands/TOOLS.md'); break;
            default: throw new Error('Invalid organ');
        }

        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        await fs.writeFile(filePath, content, 'utf-8');

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error writing organ:', error);
        return NextResponse.json({ error: 'Failed to update organ' }, { status: 500 });
    }
}
