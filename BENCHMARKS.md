# Benchmarks — AceAuth vs. Alternatives

This document presents a controlled performance comparison of common Node.js authentication strategies, including AceAuth—a hybrid JWT + session-based authentication system.

The goal is to quantify trade-offs in throughput, latency, security guarantees, and scalability, rather than to declare a single winner.

---

## 🧪 Test Environment

| Component           | Value                          |
|---------------------|--------------------------------|
| **Runtime**         | Node.js (LTS)                 |
| **Framework**       | Express                       |
| **Auth Load Tool**  | autocannon                    |
| **Redis**           | Local Redis (single instance) |
| **CPU**             | Local dev machine             |
| **OS**              | Linux                         |
| **Test Duration**   | 8 seconds                     |
| **Concurrent Users**| 50 connections                |
| **Warm-up**         | Yes (2s per test)             |
| **Redis Isolation** | Yes (flush before each run)   |

> **Note**: These benchmarks measure steady-state performance, not cold starts.

---

## 🔐 Authentication Strategies Tested

1. **Raw JWT (Stateless)**  
    - Direct `jsonwebtoken.verify()`
    - No middleware abstraction
    - No caching or revocation

2. **Passport.js (JWT Strategy)**  
    - Industry-standard JWT middleware
    - Stateless verification
    - Includes strategy and middleware overhead
    - No server-side revocation

3. **AceAuth (Hybrid JWT + Redis)**  
    - JWT as an identifier only
    - Redis as the source of truth
    - L1 (RAM) + L2 (Redis) caching
    - Token rotation and revocation
    - Write throttling to Redis

4. **Express-session (Redis-backed)**  
    - Cookie-based sessions
    - No cryptography per request
    - Fully stateful

---

## 📈 Results (Latest Run)

### 📊 Final Standings (Requests Per Second)
| Strategy                  | RPS         |
|---------------------------|-------------|
| **Express-session**       | 3037.13 RPS |
| **AceAuth (Hybrid)**      | 948.13 RPS  |
| **Raw JWT (Baseline)**    | 725.00 RPS  |
| **Passport.js (JWT)**     | 443.75 RPS  |

### Latency (Median / p50)
| Strategy           | p50 Latency |
|--------------------|-------------|
| **Express-session**| ~11 ms      |
| **AceAuth**        | ~34 ms      |
| **Raw JWT**        | ~97 ms      |
| **Passport.js**    | ~109 ms     |

> **Note**: Percentile resolution (e.g., p95) may appear undefined in short runs. Increasing the test duration to 20 seconds resolves this.

---

## 🔍 Key Observations

### 1️⃣ Why Express-session is the Fastest
- **Advantages**:
  - No JWT signature verification
  - No cryptography per request
  - Simple Redis lookup
- **Trade-offs**:
  - Fully stateful
  - Requires a shared session store
  - Harder to scale globally

### 2️⃣ Why AceAuth Outperforms Passport.js (2.1× Faster)
- **AceAuth Hot-path Behavior**:
  - JWT verified once
  - Session served from L1 RAM cache
  - Redis bypassed entirely
  - No write amplification (touch throttled)
- **Passport.js Behavior**:
  - JWT verification on every request
  - Middleware and strategy overhead
  - No caching layer

> **Result**: Caching beats pure cryptography under load.

### 3️⃣ Why Raw JWT Underperforms AceAuth
- **Raw JWT**:
  - Performs `jsonwebtoken.verify()` on every request
  - No request short-circuiting or hot-path optimization
- **AceAuth**:
  - Avoids both Redis and cryptography on the hot path

---

## 🧠 Architectural Insights

### AceAuth Two-tier Authentication Cache
```
Client
  ↓
JWT (identifier only)
  ↓
L1 Cache (RAM, ~2s TTL)  ← hot path
  ↓
L2 Store (Redis)         ← cold path / authority
```

- **Design Goals**:
  - Fast hot-path authentication
  - Immediate server-side revocation
  - Bounded staleness (≤ cache TTL)
- **Trade-off**:
  - Default bounded inconsistency window: 2 seconds

### Redis Write Throttling
- **Optimization**:
  - Redis `touch()` occurs at most once per 10 seconds per session
  - Prevents Redis write storms under high traffic
  - Reduces Redis CPU usage significantly
- **Impact**:
  - ~50–60% latency reduction
  - ~50% throughput increase compared to earlier versions

---

## 🔐 Security Guarantees vs. Performance

| Feature                  | Raw JWT | Passport.js | Express-session | AceAuth |
|--------------------------|---------|-------------|-----------------|---------|
| **Stateless Auth**       | ✅      | ✅          | ❌              | ✅ (hot path) |
| **Server-side Revocation**| ❌      | ❌          | ✅              | ✅       |
| **Token Rotation**       | ❌      | ❌          | ❌              | ✅       |
| **Device/Session Tracking**| ❌     | ❌          | ❌              | ✅       |
| **Bounded Revocation Delay**| ❌    | ❌          | ❌              | ✅ (2s)  |

---

## 🎯 Conclusions

- **Express-session**: Fastest but sacrifices stateless scalability.
- **Passport.js**: Clean but incurs full cryptographic cost per request.
- **Raw JWT**: Simple but lacks advanced control mechanisms.
- **AceAuth**: Best balance of performance and security:
  - Stateless hot path
  - Stateful guarantees
  - Competitive performance
  - Explicit trade-offs

> **AceAuth** retains ~214% of Passport.js throughput while adding revocation, rotation, and session awareness.

---

## 📌 Reproducibility

- **Benchmark Script**: `bench/versus.js`
- **To Reproduce**:
  ```bash
  node bench/versus.js
  ```

---

## 🧠 Takeaway

AceAuth is built on a simple principle:

> **Optimize for the common case, protect against the worst case.**

This benchmark demonstrates that well-designed caching can outperform naive stateless designs while providing stronger security guarantees.
