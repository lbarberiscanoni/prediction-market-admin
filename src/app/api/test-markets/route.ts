// src/app/api/test-markets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import supabase from '@/lib/supabase/createClient';

// GET - Fetch all test markets
export async function GET() {
  try {
    const { data: markets, error } = await supabase
      .from('test_markets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ markets });
  } catch (error) {
    console.error('Error fetching test markets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch test markets' },
      { status: 500 }
    );
  }
}

// POST - Create a new test market
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      creator_id,
      name,
      description,
      token_pool = 1000,
      market_maker = "CPMM",
      tags = []
    } = body;

    // Validate required fields
    if (!creator_id || !name || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: creator_id, name, description' },
        { status: 400 }
      );
    }

    // Insert the market
    const { data: market, error: marketError } = await supabase
      .from('test_markets')
      .insert({
        creator_id,
        name,
        description,
        token_pool,
        market_maker,
        tags,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (marketError) throw marketError;

    return NextResponse.json({ market }, { status: 201 });

  } catch (error) {
    console.error('Error creating test market:', error);
    return NextResponse.json(
      { error: 'Failed to create test market' },
      { status: 500 }
    );
  }
}