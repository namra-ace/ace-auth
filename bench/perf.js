const autocannon = require('autocannon');
const express = require('express');
const { createClient } = require('redis'); 
const { AceAuth, RedisStore, MemoryStore } = require('../dist/index'); 
const { gatekeeper } = require('../dist/middleware/gatekeeper');

const PORT = 5000;
const DURATION = 10; // Seconds per test
const CONNECTIONS = 100;

async function startServer() {
    const app = express();

    // 1. Setup Redis (REAL WORLD MODE)
    // We force IPv4 (127.0.0.1) to prevent Node.js from trying IPv6 (::1) which adds latency.
    const redis = createClient({
        socket: {
            host: '127.0.0.1', 
            port: 6379
        }
    });
    
    await redis.connect();

    // 2. Initialize AceAuth with RedisStore
    const auth = new AceAuth({
        secret: 'bench-secret',
        store: new RedisStore(redis), // <--- USING REDIS
        sessionDuration: 3600,
        tokenDuration: '15m'
    });

    /* // OPTIONAL: MemoryStore (For CPU Isolation Tests)
    const auth = new AceAuth({
        secret: 'bench-secret',
        store: new MemoryStore(),
        sessionDuration: 3600,
        tokenDuration: '15m'
    }); 
    */

    // 3. Setup Routes

    // A. The Control Group (No Auth)
    app.get('/baseline', (req, res) => res.send('ok'));

    // B. The Variable Group (Protected by YOU)
    app.get('/protected', gatekeeper(auth), (req, res) => res.send('ok'));

    // Setup Token Helper
    app.get('/token', async (req, res) => {
        const { token } = await auth.login({ id: 'bench-user' }, req);
        res.json({ token });
    });

    return new Promise(resolve => {
        const server = app.listen(PORT, async () => {
            // Fetch a valid token for testing
            const fetch = global.fetch || (await import('node-fetch')).default;
            
            const res = await fetch(`http://localhost:${PORT}/token`);
            const data = await res.json();
            resolve({ server, token: data.token, redis });
        });
    });
}

async function runTest(name, url, token = null) {
    console.log(`\n🔥 Testing: ${name} ...`);

    const result = await autocannon({
        url,
        connections: CONNECTIONS,
        duration: DURATION,
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        pipelining: 1, 
    });

    console.log(`   RPS:     ${result.requests.average.toFixed(0)}`);
    console.log(`   Latency: ${result.latency.average.toFixed(2)} ms`);
    return result;
}

(async () => {
    console.log('🚀 Initializing REAL-WORLD Benchmark (Redis)...');
    
    // Ensure Redis is running!
    try {
        const { server, token, redis } = await startServer();

        // 1. Run Baseline (Raw Express Speed)
        const baseline = await runTest('Baseline (Raw Express)', `http://localhost:${PORT}/baseline`);

        // 2. Run Protected (Your Library)
        const protected = await runTest('Protected (AceAuth - Redis)', `http://localhost:${PORT}/protected`, token);

        // 3. Calculate Overhead
        const rpsDrop = ((baseline.requests.average - protected.requests.average) / baseline.requests.average) * 100;
        const latencyAdd = protected.latency.average - baseline.latency.average;

        console.log('\n📊 --- FINAL VERDICT ---');
        console.log(`Raw Express RPS:    ${baseline.requests.average.toFixed(0)}`);
        console.log(`AceAuth (Redis) RPS:${protected.requests.average.toFixed(0)}`);
        console.log(`--------------------------------`);
        console.log(`Library Overhead:   ${latencyAdd.toFixed(3)} ms per request`);
        console.log(`Throughput Cost:    ${rpsDrop.toFixed(1)}%`);

        if (latencyAdd < 10) {
            console.log('\n✅ PERFORMANCE STATUS: EXCELLENT (Enterprise Grade)');
        } else {
            console.log('\n⚠️ PERFORMANCE STATUS: GOOD (Database Overhead Detected)');
        }

        server.close();
        await redis.disconnect();
        process.exit();
    } catch (e) {
        console.error("\n❌ ERROR: Is Redis running? (`redis-server --daemonize yes`)");
        console.error(e);
        process.exit(1);
    }
})();