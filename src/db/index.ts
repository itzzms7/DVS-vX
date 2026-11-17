import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: false,
    });

    global._postgresPool.on('error', (err: Error & { code?: string }) => {
      const msg = String(err?.message || '');
      const code = String(err?.code || '');
      const isTransientIdleClose =
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Connection terminated') ||
        code === 'ECONNRESET' ||
        code === 'EPIPE' ||
        code === '57P01' ||
        code === '57P03';
      if (isTransientIdleClose) {
        // Cloud SQL / proxy recycles idle pooled connections; pg-pool evicts dead clients automatically.
        return;
      }
      console.warn('SQL pool client reset:', msg || code || err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    const isTransient =
      msg.includes('Connection terminated') ||
      msg.includes('Client has encountered a connection error') ||
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === '57P01' ||
      code === '57P03';
    if (!isTransient) {
      throw err;
    }
    await new Promise((r) => setTimeout(r, 150));
    return await operation();
  }
}

export const db = drizzle(pool, { schema });
