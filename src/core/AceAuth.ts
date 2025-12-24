import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import { LRUCache } from 'lru-cache';
import { IStore } from '../interfaces/IStore';

export interface AceAuthOptions {
  secret: string;
  store: IStore;
  sessionDuration: number;
  tokenDuration: string;
  smtp?: any;
  cacheTTL?: number;
}

export interface AuthResult {
  valid: boolean;
  sessionId?: string;
  user?: any;
  token?: string; // ✅ NEW: Library handles rotation internally
  error?: string;
}

export class AceAuth {
  private mailer: any;
  private localCache: LRUCache<string, any>;
  private lastTouch: Map<string, number>; // ✅ NEW: For throttling Redis writes

  constructor(private options: AceAuthOptions) {
    if (this.options.smtp) {
      this.mailer = nodemailer.createTransport(this.options.smtp);
    }

    // L1 Cache (RAM) - "The Shield"
    // Absorbs 99% of read traffic for active users
    this.localCache = new LRUCache({
      max: 10000,
      ttl: this.options.cacheTTL || 2000, // Default 2s
    });

    // Track last write to Redis to prevent "Write Hammering"
    this.lastTouch = new Map();
  }

  // ==========================================
  // CORE AUTHENTICATION LOGIC
  // ==========================================

  async login(payload: any, req?: any) {
    const sessionId = uuidv4();
    const deviceInfo = {
      ip: req?.ip || req?.socket?.remoteAddress || 'unknown',
      userAgent: req?.headers?.['user-agent'] || 'unknown',
      loginAt: new Date().toISOString()
    };

    const fullPayload = { ...payload, _meta: deviceInfo };

    // 1. Write to Redis (L2)
    await this.options.store.set(sessionId, JSON.stringify(fullPayload), this.options.sessionDuration);

    // 2. Write to RAM (L1) & Freeze for safety ❄️
    // We freeze the object to prevent accidental mutation of the cache by reference
    this.localCache.set(sessionId, Object.freeze(fullPayload));

    // 3. Generate Token (Identifier Only) 🛡️
    const token = this.signToken(sessionId);
    
    return { token, sessionId };
  }

  async authorize(token: string): Promise<AuthResult> {
    try {
      // PATH A: Valid Signature
      const decoded: any = jwt.verify(token, this.options.secret);
      // We pass 'false' because token is fresh, no need to re-issue
      return await this.fetchSession(decoded.sessionId, false);

    } catch (err: any) {
      // PATH B: Expired Token (Graceful Refresh)
      if (err.name === 'TokenExpiredError') {
        const decoded: any = jwt.decode(token);

        if (!decoded || !decoded.sessionId) {
          return { valid: false, error: 'Invalid Token Structure' };
        }

        // We pass 'true' to auto-generate a new token internally
        return await this.fetchSession(decoded.sessionId, true);
      }
      return { valid: false, error: err.message };
    }
  }

  /**
   * SMART FETCH: RAM -> Redis -> Smart Touch -> Rotation
   */
  private async fetchSession(sessionId: string, needsRefresh: boolean): Promise<AuthResult> {
    let user: any;

    // 1. CHECK RAM (L1) ⚡
    const cachedUser = this.localCache.get(sessionId);
    if (cachedUser) {
      user = cachedUser;
    } else {
      // 2. CHECK REDIS (L2) 🐢
      const sessionData = await this.options.store.get(sessionId);
      if (!sessionData) return { valid: false, error: 'Session Revoked' };

      user = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
      
      // 3. POPULATE RAM & FREEZE ❄️
      this.localCache.set(sessionId, Object.freeze(user));
    }

    // 4. SMART TOUCH (Throttle Writes) 🚦
    // Only write to Redis if we haven't touched this session in 10 seconds.
    // This reduces Redis load by 99% for highly active users.
    const now = Date.now();
    const last = this.lastTouch.get(sessionId) || 0;
    
    if (now - last > 10000) { // 10 seconds throttle
       await this.options.store.touch(sessionId, this.options.sessionDuration);
       this.lastTouch.set(sessionId, now);
    }

    // 5. HANDLE ROTATION (Abstraction Fixed) 🔄
    let newToken: string | undefined;
    if (needsRefresh) {
      newToken = this.signToken(sessionId);
    }

    return {
      valid: true,
      sessionId,
      user,
      token: newToken // Middleware simply checks if this exists
    };
  }

  /**
   * Generates a signed JWT (Identifier Only)
   */
  public signToken(sessionId: string) {
    // ✅ FIX: No user data in JWT. Just ID.
    return jwt.sign(
      { sessionId },
      this.options.secret,
      { expiresIn: this.options.tokenDuration as any }
    );
  }

  async logout(sessionId: string) {
    this.localCache.delete(sessionId);
    this.lastTouch.delete(sessionId); // Clean up memory map
    await this.options.store.delete(sessionId);
  }

  async logoutAll(userId: string) {
    // NOTE: This clears Redis immediately.
    // L1 Cache (RAM) on other servers will persist for cacheTTL (default 2s).
    // This is a known distributed system trade-off (Eventual Consistency).
    await this.options.store.deleteByUser(userId);
  }

  // ==========================================
  // OTP / EMAIL LOGIC (Standard)
  // ==========================================
  async sendOTP(email: string) {
    if (!this.mailer) throw new Error('SMTP config not provided');
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.options.store.set(`otp:${email}`, code, 600);
    await this.mailer.sendMail({
      from: '"AceAuth Security" <no-reply@example.com>',
      to: email,
      subject: 'Verification Code',
      html: `<h1>${code}</h1>`
    });
    return { success: true };
  }

  async verifyOTP(email: string, code: string) {
    const key = `otp:${email}`;
    const storedCode = await this.options.store.get(key);
    if (!storedCode) return { valid: false, error: 'Invalid code' };
    if (storedCode !== code) return { valid: false, error: 'Incorrect code' };
    await this.options.store.delete(key);
    return { valid: true };
  }

    // ==========================================
  // DEVICE / SESSION MANAGEMENT
  // ==========================================
  async getActiveSessions(userId: string) {
    const sessions = await this.options.store.findAllByUser(userId);

    return sessions.map((s) => {
      const data = typeof s === 'string' ? JSON.parse(s) : s;

      return {
        sessionId: 'hidden', // never expose raw session id
        device: data._meta || {
          ip: 'unknown',
          userAgent: 'unknown',
        },
        loginAt: data._meta?.loginAt,
        user: data,
      };
    });
  }

}