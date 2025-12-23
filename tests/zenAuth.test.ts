import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { AceAuth } from '../src/core/AceAuth';
import { MemoryStore } from '../src/adapters/MemoryStore';

// Mock Nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn().mockResolvedValue(true)
    })
  }
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AceAuth System', () => {
  let auth: AceAuth;
  let store: MemoryStore;
  const SECRET = 'test-secret-key';

  beforeEach(() => {
    store = new MemoryStore();
    auth = new AceAuth({
      secret: SECRET,
      store: store,
      sessionDuration: 30, // 30 seconds
      tokenDuration: '1s', // 1 second
      smtp: { host: 'fake' }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // CORE AUTH TESTS
  // ==========================================

  it('should login and return a token + session', async () => {
    const { token, sessionId } = await auth.login({ id: 1 });
    expect(token).toBeDefined();
    expect(await store.get(sessionId)).toBeTruthy();
  });

  it('should validate a fresh token', async () => {
    const { token } = await auth.login({ id: 1 });
    const result = await auth.authorize(token);
    expect(result.valid).toBe(true);
  });

  it('should handle "Graceful Expiration" (The Resume Feature)', async () => {
    const { token, sessionId } = await auth.login({ id: 99 });
    
    // Wait for token to die (1.5s > 1s)
    await sleep(1500);

    const result = await auth.authorize(token);

    // Should succeed because Session is still alive
    expect(result.valid).toBe(true);
    if(result.valid) {
      expect(result.sessionId).toBe(sessionId);
    }
  });

  it('should fail if the session is manually deleted (Instant Revocation)', async () => {
    const { token, sessionId } = await auth.login({ id: 50 });
    await auth.logout(sessionId);

    const result = await auth.authorize(token);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Session expired in database');
  });

  // ==========================================
  // SECURITY TESTS
  // ==========================================

  it('should REJECT a tampered token (Invalid Signature)', async () => {
    const { sessionId } = await auth.login({ id: 666 });

    // Hacker signs token with WRONG secret
    const fakeToken = jwt.sign(
      { sessionId, id: 666 }, 
      'WRONG-SECRET', 
      { expiresIn: '1m' }
    );

    const result = await auth.authorize(fakeToken);
    expect(result.valid).toBe(false);
    expect(result.error).not.toBe('TokenExpiredError'); 
  });

  it('should handle the Full OTP Flow (Email Verification)', async () => {
    const email = 'test@example.com';
    await auth.sendOTP(email);

    // Cheat: Peek into store to get the code
    const storedCode = await store.get(`otp:${email}`);
    expect(storedCode).toHaveLength(6);

    // Verify
    if(storedCode) {
      const successResult = await auth.verifyOTP(email, storedCode);
      expect(successResult.valid).toBe(true);
      
      // Replay Attack Check (Should be gone)
      expect(await store.get(`otp:${email}`)).toBeNull();
    }
  });

  // ==========================================
  // DEVICE MANAGEMENT & DASHBOARD TESTS (NEW)
  // ==========================================

  it('should capture Device Metadata (IP/UserAgent) on login', async () => {
    // Simulate Express Request
    const mockReq = { 
      ip: '192.168.1.1', 
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)' } 
    };

    const { sessionId } = await auth.login({ id: 'user-1' }, mockReq);
    
    // Check Database Content
    const storedRaw = await store.get(sessionId);
    const storedData = JSON.parse(storedRaw || '{}');

    expect(storedData._meta).toBeDefined();
    expect(storedData._meta.ip).toBe('192.168.1.1');
    expect(storedData._meta.userAgent).toContain('Mozilla');
  });

  it('should list all active sessions for a specific User (Dashboard)', async () => {
    const userId = 'dashboard-user';
    
    // Login 3 times (3 devices)
    await auth.login({ id: userId, device: 'Mobile' });
    await auth.login({ id: userId, device: 'Desktop' });
    await auth.login({ id: userId, device: 'Tablet' });

    // Login a DIFFERENT user (Should not show up)
    await auth.login({ id: 'other-user' });

    // Get Active Sessions
    const sessions = await auth.getActiveSessions(userId);

    expect(sessions).toHaveLength(3);
    // Verify we got the user data back
    expect(sessions[0].user.id).toBe(userId);
  });

  it('should Logout All devices for a user', async () => {
    const userId = 'bad-actor';
    
    // Create 2 sessions
    await auth.login({ id: userId });
    await auth.login({ id: userId });
    
    // Verify they exist
    let sessions = await auth.getActiveSessions(userId);
    expect(sessions).toHaveLength(2);

    // NUKE THEM
    await auth.logoutAll(userId);

    // Verify they are gone
    sessions = await auth.getActiveSessions(userId);
    expect(sessions).toHaveLength(0);
  });

  it('should filter out expired sessions automatically (Lazy Cleanup)', async () => {
    // 1. Create a session that expires very fast (using a custom Auth instance for this test)
    const fastAuth = new AceAuth({
      secret: SECRET,
      store: store, // Share the store
      sessionDuration: 1, // 1 second session duration!
      tokenDuration: '1s'
    });

    await fastAuth.login({ id: 'lazy-user' });
    
    // 2. Wait 1.1 seconds (Session dies)
    await sleep(1100);

    // 3. Create a NEW valid session
    await auth.login({ id: 'lazy-user' }); // Normal duration

    // 4. Get Sessions. 
    // It should find 2 potential keys, but realize 1 is dead and clean it up.
    const sessions = await auth.getActiveSessions('lazy-user');

    expect(sessions).toHaveLength(1); // Only the new one remains
  });
});