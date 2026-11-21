import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export const dataDirectory = resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

export const db = new Database(resolve(dataDirectory, 'farm.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    area REAL NOT NULL CHECK (area > 0),
    soilType TEXT NOT NULL,
    UNIQUE (userId, id),
    UNIQUE (userId, name)
  );
  CREATE TABLE IF NOT EXISTS crops (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    UNIQUE (userId, id),
    UNIQUE (userId, name)
  );
  CREATE TABLE IF NOT EXISTS sowings (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL,
    fieldId INTEGER NOT NULL,
    cropId INTEGER NOT NULL,
    season INTEGER NOT NULL,
    sowingDate TEXT NOT NULL,
    harvestDate TEXT CHECK (harvestDate >= sowingDate),
    yield REAL CHECK (yield >= 0),
    FOREIGN KEY (userId, fieldId) REFERENCES fields(userId, id),
    FOREIGN KEY (userId, cropId) REFERENCES crops(userId, id),
    UNIQUE (userId, fieldId, season),
    UNIQUE (userId, fieldId, id)
  );
  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY,
    userId INTEGER NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    fieldId INTEGER NOT NULL,
    sowingId INTEGER,
    note TEXT NOT NULL,
    FOREIGN KEY (userId, fieldId) REFERENCES fields(userId, id),
    FOREIGN KEY (userId, fieldId, sowingId) REFERENCES sowings(userId, fieldId, id)
  );
`);

