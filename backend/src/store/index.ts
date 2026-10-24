import { RepositoryStore } from './repositoryStore.js';
import { SqliteRepositoryStore } from './sqliteStore.js';
import { InMemoryRepositoryStore } from './memoryStore.js';
import { MongoRepositoryStore } from './mongoStore.js';
import { config, getDatabasePath } from '../config.js';

export * from './repositoryStore.js';
export * from './sqliteStore.js';
export * from './memoryStore.js';
export * from './mongoStore.js';

export function createRepositoryStore(useMemory = false, customPath?: string): RepositoryStore {
  if (useMemory || config.NODE_ENV === 'test') {
    return new InMemoryRepositoryStore();
  }

  if (config.MONGODB_URI && config.MONGODB_URI.trim().length > 5) {
    return new MongoRepositoryStore(config.MONGODB_URI);
  }

  const dbPath = customPath || getDatabasePath();
  return new SqliteRepositoryStore(dbPath);
}
