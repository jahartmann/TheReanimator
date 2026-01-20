import { NextResponse } from 'next/server';
import { getServerStorages } from '@/app/actions/storage';

export async function GET() {
    const stats = await getServerStorages();
    return NextResponse.json(stats);
}
