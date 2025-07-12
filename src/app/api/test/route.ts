// src/app/api/test/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  console.log('Test API route called');
  return NextResponse.json({ 
    message: 'API routes are working!',
    timestamp: new Date().toISOString()
  });
}