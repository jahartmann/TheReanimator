import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
    const servers = db.prepare('SELECT * FROM servers ORDER BY name').all();
    return NextResponse.json(servers);
}
