# 🛡️ ZenAuth

> **Stateful Security, Stateless Speed.**  
> An enterprise-grade identity management library featuring "Graceful Token Rotation," Device Fingerprinting, and Sliding Window sessions.

![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue)
![Coverage](https://img.shields.io/badge/Tests-100%25_Passing-green)
![License](https://img.shields.io/badge/License-MIT-purple)
![Size](https://img.shields.io/badge/Size-Lightweight-orange)

---

## 💡 Why ZenAuth?

In modern web development, you typically have to choose between **Security** (short-lived JWTs) and **User Experience** (long-lived sessions).  

**ZenAuth gives you both.** It uses a **Hybrid Architecture** to maintain security without forcing users to log in repeatedly.

| Feature         | Standard JWT               | ZenAuth                     |
|------------------|----------------------------|-----------------------------|
| **Revocation**   | ❌ Impossible until expiry | ✅ Instant (DB Backed)      |
| **Performance**  | ✅ High (Stateless)        | ✅ High (Redis Caching)     |
| **UX**           | ❌ Hard Logout on expiry   | ✅ Graceful Auto-Rotation   |
| **Device Mgmt**  | ❌ None                    | ✅ Active Sessions View     |

---

## 🌟 Key Features

- **🛡️ Dual-Layer Verification:** Combines 1-minute ephemeral JWTs with 30-day database sessions.
- **🔄 Graceful Expiration:** Solves the "Idle Logout" problem. If a token expires but the user is active, the system transparently issues a fresh one.
- **📱 Device Fingerprinting:** Automatically captures IP, User-Agent, and Login Time for security auditing.
- **🕵️ Active Sessions Dashboard:** Allows users to see *"Logged in on Chrome (Windows)"* and remotely revoke specific devices.
- **🔌 Database Agnostic:** Native adapters for **Redis**, **MongoDB**, **PostgreSQL**, and Memory.

---

## 🏗️ System Architecture

### 1. The "Graceful Expiration" Flow

Instead of rejecting an expired token immediately, ZenAuth checks the database to see if the user's *session* is still valid. If it is, the request is allowed, and a new token is sent back automatically.

```mermaid
sequenceDiagram
    participant Client
    participant Middleware
    participant Database

    Client->>Middleware: Sends Request (Token Expired)
    Middleware->>Middleware: Signature Valid? ✅
    Middleware->>Middleware: Time Check: Expired ❌
    
    Note right of Middleware: "Graceful Rescue" Triggered
    
    Middleware->>Database: Check Session ID
    Database-->>Middleware: Session Active (30 Days left)
    
    Middleware->>Client: 200 OK + New Token (Header)
```

### 2. Secondary Indexing (Redis)

To support `getActiveSessions()` efficiently without scanning the entire database (which is O(N) and slow), ZenAuth maintains a Secondary Index using Redis Sets.

- **Key 1 (Data):** `session:123 → { user: 'A', ip: '...' }`
- **Key 2 (Index):** `idx:user:A → [ 'session:123', 'session:456' ]`

This ensures O(1) lookup performance even with millions of users.

---

## 🚀 Installation

```bash
npm install zen-auth
```

---

## 🏃 Quick Start

### 1. Initialize

ZenAuth works with your existing database. Here is a Redis example:

```typescript
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
```

### 2. Login & Capture Device Info

Pass the request object (`req`) so ZenAuth can fingerprint the device.

```typescript
app.post('/login', async (req, res) => {
  // 1. Verify credentials (your logic)
  const user = await checkPassword(req.body.email, req.body.password);
  
  // 2. Create Session
  const { token } = await auth.login({ id: user.id }, req);
  
  res.json({ token });
});
```

### 3. Build the "Security Dashboard"

This feature is what makes ZenAuth stand out. Allow users to manage their own security.

```typescript
import { gatekeeper } from 'zen-auth/middleware';

// GET /sessions -> Returns active devices
app.get('/sessions', gatekeeper(auth), async (req, res) => {
  const sessions = await auth.getActiveSessions(req.user.id);
  res.json(sessions);
});
/* Response:
[
  { 
    device: { ip: '192.168.1.5', userAgent: 'Chrome on MacOS' }, 
    loginAt: '2023-10-27T10:00:00Z' 
  }
]
*/

// POST /logout-all -> Emergency kill switch
app.post('/logout-all', gatekeeper(auth), async (req, res) => {
  await auth.logoutAll(req.user.id);
  res.send('Logged out of all devices.');
});
```

---

## 🧪 Testing

This library is built with Test Driven Development (TDD) using Vitest.

```bash
# Run the full test suite
npm run test
```

### Coverage Includes:

- ✅ Token Tampering (Invalid Signature)
- ✅ Replay Attacks (OTP Verification)
- ✅ Idle Timeouts vs Active Usage
- ✅ Device Metadata Storage

---

## 🔌 Adapters Supported

| Adapter       | Use Case                       |
|---------------|--------------------------------|
| **MemoryStore** | Local Development / Testing   |
| **RedisStore**  | Production (Recommended) - Fastest |
| **MongoStore**  | Document-based persistence    |
| **PostgresStore** | SQL-based persistence       |