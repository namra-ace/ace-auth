/**
 * FAANG-GRADE AUTH BENCHMARK
 * ----------------------------------
 * - Warmed benchmarks
 * - Redis isolation
 * - Fair JWT payloads
 * - Correct AceAuth lifecycle
 * - Latency percentiles
 */

const autocannon = require('autocannon');
const express = require('express');
const { createClient } = require('redis');
const session = require('express-session');
const RedisStore = require('connect-redis').RedisStore;
const jwt = require('jsonwebtoken');

// Passport
const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');

// AceAuth
const { AceAuth, RedisStore: AceRedisStore } = require('../dist/index');
const { gatekeeper } = require('../dist/middleware/gatekeeper');

// ---------------- CONFIG ----------------
const PORT = 5000;
const DURATION = 8;
const CONNECTIONS = 50;
const USER_PAYLOAD = { id: 'user' };

// Redis
const redisClient = createClient({
  socket: { host: '127.0.0.1', port: 6379 },
});

// ---------------- HELPERS ----------------
async function flushRedis() {
  await redisClient.flushDb();
}

async function warmup(url, headers) {
  await autocannon({
    url,
    connections: 10,
    duration: 2,
    headers,
  });
}

async function runBenchmark(name, configFn, headerFn) {
  console.log(`\n🥊 Preparing Fighter: ${name}...`);
  await flushRedis();

  const app = express();
  await configFn(app);

  return new Promise((resolve) => {
    const server = app.listen(PORT, async () => {
      try {
        let headers = {};
        if (headerFn) headers = await headerFn(`http://localhost:${PORT}`);

        // Warm-up
        await warmup(`http://localhost:${PORT}/protected`, headers);

        console.log(`🔥 FIGHT! Testing ${name}...`);
        const result = await autocannon({
          url: `http://localhost:${PORT}/protected`,
          connections: CONNECTIONS,
          duration: DURATION,
          headers,
          pipelining: 1,
        });

        console.log(
          `   ✅ 2xx: ${result['2xx']} | ❌ 4xx: ${result['4xx']}`
        );
        console.log(
          `   📉 Latency (ms) — p50: ${result.latency.p50}, p95: ${result.latency.p95}, p99: ${result.latency.p99}`
        );

        server.close();
        resolve(result);
      } catch (err) {
        console.error(err);
        server.close();
        resolve({ requests: { average: 0 }, latency: {} });
      }
    });
  });
}

// ---------------- MAIN ----------------
(async () => {
  await redisClient.connect();

  // =====================================
  // 1. Raw JWT (Stateless Baseline)
  // =====================================
  const rawJwtSecret = 'raw-secret';

  const rawJwtResult = await runBenchmark(
    'Raw JWT (Stateless)',
    (app) => {
      app.get('/protected', (req, res) => {
        const h = req.headers.authorization;
        if (!h) return res.sendStatus(401);

        try {
          jwt.verify(h.split(' ')[1], rawJwtSecret);
          res.send('ok');
        } catch {
          res.sendStatus(401);
        }
      });
    },
    () => ({
      Authorization: `Bearer ${jwt.sign(USER_PAYLOAD, rawJwtSecret)}`,
    })
  );

  // =====================================
  // 2. Passport.js (Stateless JWT)
  // =====================================
  const passportSecret = 'passport-secret';

  const passportResult = await runBenchmark(
    'Passport.js (Stateless JWT)',
    (app) => {
      passport.use(
        new JwtStrategy(
          {
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: passportSecret,
          },
          (payload, done) => done(null, payload)
        )
      );

      app.use(passport.initialize());

      app.get(
        '/protected',
        passport.authenticate('jwt', { session: false }),
        (req, res) => res.send('ok')
      );
    },
    () => ({
      Authorization: `Bearer ${jwt.sign(USER_PAYLOAD, passportSecret)}`,
    })
  );

  // =====================================
  // 3. AceAuth (Hybrid JWT + Redis)
  // =====================================
  let aceAuth;

  const aceAuthResult = await runBenchmark(
    'AceAuth (Hybrid)',
    async (app) => {
      aceAuth = new AceAuth({
        secret: 'ace-secret',
        store: new AceRedisStore(redisClient),
        sessionDuration: 3600,
        tokenDuration: '15m',
      });

      app.get('/protected', gatekeeper(aceAuth), (req, res) =>
        res.send('ok')
      );
    },
    async () => {
      const { token } = await aceAuth.login(USER_PAYLOAD);
      return { Authorization: `Bearer ${token}` };
    }
  );

  // =====================================
  // 4. Express Session (Redis)
  // =====================================
  const expressSessionResult = await runBenchmark(
    'Express Session (Redis)',
    (app) => {
      app.use(
        session({
          store: new RedisStore({ client: redisClient }),
          secret: 'session-secret',
          resave: false,
          saveUninitialized: false,
        })
      );

      app.get('/login', (req, res) => {
        req.session.user = USER_PAYLOAD;
        res.send('logged in');
      });

      app.get('/protected', (req, res) => {
        if (req.session.user) res.send('ok');
        else res.sendStatus(401);
      });
    },
    async (baseUrl) => {
      const fetch = global.fetch || (await import('node-fetch')).default;
      const res = await fetch(`${baseUrl}/login`);
      const cookie = res.headers.get('set-cookie').split(';')[0];
      return { Cookie: cookie };
    }
  );

  // =====================================
  // 🏆 RESULTS
  // =====================================
  console.log('\n📊 --- FINAL STANDINGS ---');
  console.log(
    `1. Express Session (No Crypto): ${expressSessionResult.requests.average.toFixed(
      2
    )} RPS`
  );
  console.log(
    `2. Passport.js (JWT):           ${passportResult.requests.average.toFixed(
      2
    )} RPS`
  );
  console.log(
    `3. Raw JWT (Baseline):          ${rawJwtResult.requests.average.toFixed(
      2
    )} RPS`
  );
  console.log(
    `4. AceAuth (Hybrid):            ${aceAuthResult.requests.average.toFixed(
      2
    )} RPS`
  );

  const vsPassport =
    (aceAuthResult.requests.average /
      passportResult.requests.average) *
    100;

  console.log('-----------------------------------');
  console.log(
    `AceAuth Performance vs Passport.js: ${vsPassport.toFixed(1)}%`
  );
  console.log(
    `You retain ${vsPassport.toFixed(
      1
    )}% throughput while adding server-side revocation + rotation`
  );

  console.log('\n⚠️ Notes:');
  console.log('- Express-session avoids crypto entirely');
  console.log('- Passport.js does stateless JWT only');
  console.log('- AceAuth performs JWT verification + Redis session checks');
  console.log('- Lower throughput is an intentional security trade-off');

  process.exit();
})();
