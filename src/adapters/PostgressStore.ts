import { IStore } from '../interfaces/IStore';

/**
 * REQUIRED SQL SCHEMA:
 *
 * CREATE TABLE auth_sessions (
 *   sid TEXT PRIMARY KEY,
 *   sess JSONB NOT NULL,
 *   user_id TEXT NOT NULL,
 *   expired_at TIMESTAMPTZ NOT NULL
 * );
 *
 * CREATE INDEX idx_auth_sessions_user_id ON auth_sessions(user_id);
 * CREATE INDEX idx_auth_sessions_expired_at ON auth_sessions(expired_at);
 */

interface PgPool {
  query(text: string, params?: any[]): Promise<any>;
}

export class PostgresStore implements IStore {
  private table: string;

  constructor(
    private pool: PgPool,
    tableName: string = 'auth_sessions'
  ) {
    // 🛡️ Prevent SQL injection via table name
    if (!/^[a-zA-Z_]+$/.test(tableName)) {
      throw new Error('Invalid table name');
    }
    this.table = tableName;
  }

  // ==============================
  // CORE SESSION OPERATIONS
  // ==============================

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const parsed = JSON.parse(value);

    const query = `
      INSERT INTO ${this.table} (sid, sess, user_id, expired_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sid)
      DO UPDATE SET
        sess = EXCLUDED.sess,
        user_id = EXCLUDED.user_id,
        expired_at = EXCLUDED.expired_at
    `;

    await this.pool.query(query, [
      key,
      parsed,
      parsed.id, // 🔥 REQUIRED for logoutAll & device management
      expiresAt
    ]);
  }

  async get(key: string): Promise<string | null> {
    const query = `
      SELECT sess, expired_at
      FROM ${this.table}
      WHERE sid = $1
    `;

    const result = await this.pool.query(query, [key]);

    if (!result.rows.length) return null;

    const { sess, expired_at } = result.rows[0];

    if (new Date() > expired_at) {
      // Lazy cleanup
      await this.delete(key);
      return null;
    }

    return JSON.stringify(sess);
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const query = `
      UPDATE ${this.table}
      SET expired_at = $1
      WHERE sid = $2
    `;

    await this.pool.query(query, [expiresAt, key]);
  }

  async delete(key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE sid = $1`,
      [key]
    );
  }

  // ==============================
  // USER / DEVICE MANAGEMENT
  // ==============================

  async findAllByUser(userId: string): Promise<string[]> {
    const query = `
      SELECT sess
      FROM ${this.table}
      WHERE user_id = $1 AND expired_at > NOW()
    `;

    const result = await this.pool.query(query, [userId]);

    return result.rows.map((row: any) =>
      JSON.stringify(row.sess)
    );
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE user_id = $1`,
      [userId]
    );
  }
}
