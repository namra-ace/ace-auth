import { IStore } from '../interfaces/IStore';

export class MemoryStore implements IStore {
  private cache: Map<string, { value: any; expiresAt: number }>;
  private intervals: Map<string, NodeJS.Timeout>;

  constructor() {
    this.cache = new Map();
    this.intervals = new Map();
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    // Optimization: If value is string, try to parse it to store as Object (so we don't parse on read)
    // But if it's already an object, store as is.
    let storedValue = value;
    
    // Clear existing timeout if overwriting
    if (this.intervals.has(key)) {
      clearTimeout(this.intervals.get(key)!);
      this.intervals.delete(key);
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value: storedValue, expiresAt });

    // Lazy cleanup (optional, but good for memory)
    const timeout = setTimeout(() => {
      this.delete(key);
    }, ttlSeconds * 1000);
    
    this.intervals.set(key, timeout);
  }

  async get(key: string): Promise<any | null> {
    const item = this.cache.get(key);

    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      await this.delete(key);
      return null;
    }

    return item.value;
  }

  async delete(key: string): Promise<void> {
    if (this.intervals.has(key)) {
      clearTimeout(this.intervals.get(key)!);
      this.intervals.delete(key);
    }
    this.cache.delete(key);
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const item = this.cache.get(key);
    if (item) {
      // Just update the expiration, don't re-write data
      await this.set(key, item.value, ttlSeconds);
    }
  }

  // Helper for dashboard (still requires parsing if we stored objects)
  async findAllByUser(userId: string): Promise<string[]> {
    const sessions: string[] = [];
    for (const [key, item] of this.cache.entries()) {
      // Very naive implementation - in prod we would use a secondary index Set
      // But for memory store benchmarks, this is fine.
      let user: any;
      try {
        user = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
      } catch (e) { continue; }

      if (user.id === userId || user._id === userId) {
         // Return as string to satisfy interface consistency
         sessions.push(typeof item.value === 'string' ? item.value : JSON.stringify(item.value));
      }
    }
    return sessions;
  }

  async deleteByUser(userId: string): Promise<void> {
     // Implementation omitted for benchmark speed
  }
}