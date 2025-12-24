import { IStore } from "../interfaces/IStore";

// Minimal MongoDB collection interface
interface MongoModel {
  findOne(query: any): Promise<any>;
  find(query: any): Promise<any[]>;
  updateOne(query: any, update: any, options?: any): Promise<any>;
  deleteOne(query: any): Promise<any>;
  deleteMany(query: any): Promise<any>;
}

export class MongoStore implements IStore {
  private model: MongoModel;

  constructor(mongooseCollection: any) {
    this.model = mongooseCollection;
  }

  // ==============================
  // REQUIRED BY AceAuth
  // ==============================

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const parsed = JSON.parse(value);

    await this.model.updateOne(
      { _id: key },
      {
        $set: {
          _id: key,
          data: value,
          userId: parsed.id, // 🔥 REQUIRED for logoutAll / devices
          expiresAt
        }
      },
      { upsert: true }
    );
  }

  async get(key: string): Promise<string | null> {
    const doc = await this.model.findOne({ _id: key });

    if (!doc) return null;

    if (new Date() > doc.expiresAt) {
      // Clean up expired session eagerly
      await this.delete(key);
      return null;
    }

    return doc.data;
  }

  async touch(key: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.model.updateOne(
      { _id: key },
      { $set: { expiresAt } }
    );
  }

  async delete(key: string): Promise<void> {
    await this.model.deleteOne({ _id: key });
  }

  // ==============================
  // DEVICE / USER MANAGEMENT
  // ==============================

  async findAllByUser(userId: string): Promise<string[]> {
    const docs = await this.model.find({ userId });
    return docs.map(doc => doc.data);
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.model.deleteMany({ userId });
  }
}
