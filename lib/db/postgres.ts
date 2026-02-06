/* eslint-disable @typescript-eslint/no-explicit-any */
import { Pool } from 'pg';

// PostgreSQL connection pool
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // Support both Neon serverless and local PostgreSQL
    let connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zkvanguard';
    
    // Remove channel_binding parameter if present (not supported by pg module)
    connectionString = connectionString.replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');
    
    const isNeon = connectionString.includes('neon.tech');
    
    pool = new Pool({
      connectionString,
      ssl: isNeon ? { rejectUnauthorized: false } : undefined,
      max: isNeon ? 10 : 20, // Neon free tier has connection limits
      idleTimeoutMillis: isNeon ? 10000 : 30000,
      connectionTimeoutMillis: isNeon ? 5000 : 2000,
    });

    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
  }

  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return result.rows;
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
