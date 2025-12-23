# 🛡️ ZenAuth

> **Stateful Security, Stateless Speed.**
> An enterprise-grade authentication library featuring "Graceful Token Rotation," Device Fingerprinting, and Sliding Window sessions.

![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)
![Coverage](https://img.shields.io/badge/Tests-Passing-green)
![License](https://img.shields.io/badge/License-MIT-purple)

## 💡 Why ZenAuth?

Most auth libraries are either too simple (`jsonwebtoken`) or too heavy (`Passport.js`).
**ZenAuth** sits in the sweet spot. It provides **Identity Management** without the bloat.

### 🌟 Key Features
* **Dual-Layer Verification:** Combines 1-minute JWTs with 30-day Database Sessions.
* **Graceful Expiration:** Solves the "Idle Logout" problem. If a token dies but the user is active, we transparently rotate it.
* **Device Fingerprinting:** Automatically captures IP and User-Agent on login.
* **Active Sessions Dashboard:** Users can see "Logged in on Chrome (Windows)" and remotely revoke access.
* **Database Agnostic:** Native adapters for **Redis**, **MongoDB**, and **PostgreSQL**.

---

## 📦 Installation

```bash
npm install zen-auth
🚀 Quick Start
1. Initialize
TypeScript

import { ZenAuth, RedisStore } from 'zen-auth';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const auth = new ZenAuth({
  secret: process.env.JWT_SECRET,
  store: new RedisStore(redis),
  sessionDuration: 30 * 24 * 60 * 60, // 30 Days
  tokenDuration: '1m' // Rotate every minute
});
2. Login with Device Info
TypeScript

app.post('/login', async (req, res) => {
  // Pass 'req' so ZenAuth can capture IP & User-Agent
  const { token } = await auth.login({ id: 'user-123' }, req);
  res.json({ token });
});
3. The "Security Dashboard" (Resume Feature)
Allow users to see where they are logged in and kick off strangers.

TypeScript

// GET /sessions -> Returns specific device info
app.get('/sessions', gatekeeper(auth), async (req, res) => {
  const sessions = await auth.getActiveSessions(req.user.id);
  res.json(sessions);
  // Output: [{ device: { ip: '10.0.0.1', userAgent: 'Chrome' }, loginAt: '...' }]
});

// POST /logout-all -> Emergency kill switch
app.post('/logout-all', gatekeeper(auth), async (req, res) => {
  await auth.logoutAll(req.user.id);
  res.send('Logged out of all devices.');
});
🧠 System Design Architecture
1. Secondary Indexing (Redis)
To support getActiveSessions() efficiently without scanning the entire database, ZenAuth maintains a Secondary Index using Redis Sets (SADD idx:user:123 session_id). This ensures O(1) lookup performance even with millions of users.

2. The "Graceful Expiration" Flow
Request: Client sends an expired JWT.

Check: Middleware detects expiration but checks the Database Session.

Rescue: If the DB session is valid, ZenAuth accepts the request and issues a fresh token in the X-Zen-Token header.

3. Lazy Cleanup
Expired sessions in the Redis Set are cleaned up "lazily" when accessed, ensuring that the logoutAll operation remains fast and doesn't need a background cron job.

🔌 Adapters
MemoryStore: For testing/dev.

RedisStore: High performance (Recommended).

MongoStore: For document-based storage.

PostgresStore: For SQL-based storage.