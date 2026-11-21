import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import express, { type ErrorRequestHandler, type Request } from 'express';
import jwt from 'jsonwebtoken';
import { operationTypes, type Resource, type Stats } from '../shared/types';
import { dataDirectory, db } from './db';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const secretFile = resolve(dataDirectory, 'jwt-secret');
try {
  writeFileSync(secretFile, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
const secret = readFileSync(secretFile, 'utf8');
const deriveKey = promisify(scrypt);
const app = express();
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '16kb' }));

function requiredText(value: unknown, label: string, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new HttpError(400, `${label} — укажите от 1 до ${limit} символов.`);
  }
  return value.trim();
}

function number(value: unknown, label: string, min: number, max: number, integer = false) {
  if (
    typeof value !== 'number' || !Number.isFinite(value) ||
    value < min || value > max || (integer && !Number.isSafeInteger(value))
  ) {
    throw new HttpError(400, `${label} — укажите ${integer ? 'целое число' : 'число'} от ${min} до ${max}.`);
  }
  return value;
}

function date(value: unknown, label: string) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) {
      return value;
    }
  }
  throw new HttpError(400, `${label} — укажите корректную дату.`);
}

function bodyOf(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new HttpError(400, 'Ожидаются данные формы.');
  }
  return req.body;
}

function credentials(req: Request) {
  const body = bodyOf(req);
  const email = requiredText(body.email, 'Электронная почта', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Укажите корректную электронную почту.');
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    throw new HttpError(400, 'Пароль должен содержать от 8 до 128 символов.');
  }
  return { email, password: body.password };
}

function session(id: number, email: string) {
  const token = jwt.sign({}, secret, { subject: String(id), expiresIn: '8h', algorithm: 'HS256' });
  return { email, token };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/register', (req, res, next) => {
  void (async () => {
    const { email, password } = credentials(req);
    const salt = randomBytes(16).toString('hex');
    const hash = (await deriveKey(password, salt, 64)) as Buffer;
    const row = db.prepare('INSERT OR IGNORE INTO users (email, password) VALUES (?, ?)')
      .run(email, `${salt}:${hash.toString('hex')}`);
    if (!row.changes) throw new HttpError(409, 'Учётная запись с этой почтой уже существует.');
    res.status(201).json(session(Number(row.lastInsertRowid), email));
  })().catch(next);
});

const missingUserSalt = randomBytes(16).toString('hex');
app.post('/api/login', (req, res, next) => {
  void (async () => {
    const { email, password } = credentials(req);
    const user = db.prepare('SELECT id, password FROM users WHERE email = ?').get(email) as
      { id: number; password: string } | undefined;
    const [salt, hash] = user?.password.split(':') ?? [missingUserSalt, ''];
    const key = (await deriveKey(password, salt, 64)) as Buffer;
    if (!user || !timingSafeEqual(key, Buffer.from(hash, 'hex'))) {
      throw new HttpError(401, 'Неверная почта или пароль.');
    }
    res.json(session(user.id, email));
  })().catch(next);
});

app.use('/api', (req, res, next) => {
  try {
    const auth = req.get('Authorization');
    if (!auth?.startsWith('Bearer ')) throw new Error('Missing token');
    const token = jwt.verify(auth.slice(7), secret, { algorithms: ['HS256'] });
    if (typeof token === 'string' || !token.sub || !/^\d+$/.test(token.sub)) {
      throw new Error('Missing subject');
    }
    res.locals.userId = Number(token.sub);
  } catch {
    return next(new HttpError(401, 'Войдите в аккаунт.'));
  }
  next();
});

const resources = {
  fields: { columns: ['name', 'area', 'soilType'], order: 'name' },
  crops: { columns: ['name'], order: 'name' },
  sowings: { columns: ['fieldId', 'cropId', 'season', 'sowingDate', 'harvestDate', 'yield'], order: 'season DESC, id DESC' },
  operations: { columns: ['type', 'date', 'fieldId', 'sowingId', 'note'], order: 'date DESC, id DESC' },
};

function recordId(value: unknown, label = 'Запись') {
  return number(value, label, 1, Number.MAX_SAFE_INTEGER, true);
}

function requireOwned(table: Resource, id: number, userId: number, message: string, status = 400) {
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND userId = ?`).get(id, userId)) {
    throw new HttpError(status, message);
  }
}

function resourceValues(resource: Resource, input: Record<string, unknown>, userId: number, id: number | null) {
  switch (resource) {
    case 'fields':
      return [
        requiredText(input.name, 'Название', 100),
        number(input.area, 'Площадь', 0.01, 1_000_000),
        requiredText(input.soilType, 'Тип почвы', 100),
      ];
    case 'crops':
      return [requiredText(input.name, 'Название', 100)];
    case 'sowings': {
      const fieldId = recordId(input.fieldId, 'Поле');
      const cropId = recordId(input.cropId, 'Культура');
      const season = number(input.season, 'Сезон', 1900, 2200, true);
      const sowingDate = date(input.sowingDate, 'Дата посева');
      const harvestDate = input.harvestDate == null ? null : date(input.harvestDate, 'Дата уборки');
      const yieldValue = input.yield == null ? null : number(input.yield, 'Урожайность', 0, 10_000);
      if (harvestDate && harvestDate < sowingDate) {
        throw new HttpError(400, 'Дата уборки должна быть не раньше даты посева.');
      }
      requireOwned('fields', fieldId, userId, 'Выбранное поле не найдено.');
      requireOwned('crops', cropId, userId, 'Выбранная культура не найдена.');
      const match = db.prepare(`
        SELECT season FROM sowings
        WHERE userId = ? AND fieldId = ? AND cropId = ?
          AND season IN (?, ?) AND id != ?
        ORDER BY season LIMIT 1
      `).get(userId, fieldId, cropId, season - 1, season + 1, id ?? 0) as
        { season: number } | undefined;
      if (match) {
        throw new HttpError(409, `Эта культура уже запланирована на этом поле в соседнем сезоне (${match.season}). Для севооборота выберите другую культуру.`);
      }
      return [fieldId, cropId, season, sowingDate, harvestDate, yieldValue];
    }
    case 'operations': {
      const type = operationTypes.find((option) => option === input.type);
      if (!type) throw new HttpError(400, 'Укажите вид операции.');
      const fieldId = recordId(input.fieldId, 'Поле');
      const sowingId = input.sowingId == null ? null : recordId(input.sowingId, 'Посев');
      const note = input.note == null || input.note === '' ? '' : requiredText(input.note, 'Примечание', 1000);
      requireOwned('fields', fieldId, userId, 'Выбранное поле не найдено.');
      if (
        sowingId !== null &&
        !db.prepare('SELECT 1 FROM sowings WHERE id = ? AND fieldId = ? AND userId = ?').get(sowingId, fieldId, userId)
      ) {
        throw new HttpError(400, 'Выберите посев на указанном поле.');
      }
      return [type, date(input.date, 'Дата операции'), fieldId, sowingId, note];
    }
  }
}

app.get('/api/records', (_req, res) => {
  const records = Object.entries(resources).map(([table, { columns, order }]) => [
    table,
    db.prepare(`SELECT id, ${columns.join(', ')} FROM ${table} WHERE userId = ? ORDER BY ${order}`).all(res.locals.userId),
  ]);
  res.json(Object.fromEntries(records));
});

app.get('/api/stats', (req, res) => {
  const season = number(Number(req.query.season), 'Сезон', 1900, 2200, true);
  const areas = db.prepare(`
    SELECT crops.name AS crop, ROUND(SUM(fields.area), 2) AS area
    FROM sowings
    JOIN fields ON fields.id = sowings.fieldId
    JOIN crops ON crops.id = sowings.cropId
    WHERE sowings.userId = ? AND sowings.season = ?
    GROUP BY crops.id ORDER BY area DESC, crop
  `).all(res.locals.userId, season) as Stats['areas'];
  const yields = db.prepare(`
    SELECT sowings.season, ROUND(SUM(sowings.yield * fields.area) / SUM(fields.area), 2) AS yield
    FROM sowings
    JOIN fields ON fields.id = sowings.fieldId
    WHERE sowings.userId = ? AND sowings.yield IS NOT NULL
    GROUP BY sowings.season ORDER BY sowings.season
  `).all(res.locals.userId) as Stats['yields'];
  res.json({ areas, yields } satisfies Stats);
});

for (const resource of Object.keys(resources) as Resource[]) {
  const { columns } = resources[resource];
  const path = `/api/${resource}`;
  const insert = db.prepare(`INSERT INTO ${resource} (userId, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`);
  const update = db.prepare(`UPDATE ${resource} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND userId = ?`);
  const remove = db.prepare(`DELETE FROM ${resource} WHERE id = ? AND userId = ?`);
  const save = db.transaction((userId: number, input: Record<string, unknown>, id: number | null) => {
    if (id !== null) requireOwned(resource, id, userId, 'Запись не найдена.', 404);
    const values = resourceValues(resource, input, userId, id);
    if (id === null) return Number(insert.run(userId, ...values).lastInsertRowid);
    update.run(...values, id, userId);
    return id;
  }).immediate;

  app.post(path, (req, res) => {
    res.status(201).json({ id: save(res.locals.userId, bodyOf(req), null) });
  });
  app.put(`${path}/:id`, (req, res) => {
    res.json({ id: save(res.locals.userId, bodyOf(req), recordId(Number(req.params.id))) });
  });
  app.delete(`${path}/:id`, (req, res) => {
    if (!remove.run(recordId(Number(req.params.id)), res.locals.userId).changes) {
      throw new HttpError(404, 'Запись не найдена.');
    }
    res.status(204).end();
  });
}

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Маршрут не найден.')));
app.use(express.static(resolve('dist')));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
  } else if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const message = error.message.includes('sowings.')
      ? 'Для этого поля уже есть посев в выбранном сезоне.'
      : 'Запись с таким названием уже существует.';
    res.status(409).json({ message });
  } else if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    res.status(409).json({ message: 'У записи есть связанные данные. Сначала измените или удалите их.' });
  } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(400).json({ message: 'Данные формы не удалось прочитать.' });
  } else {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера.' });
  }
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '127.0.0.1', () => {
  console.log(`Полевой журнал: http://127.0.0.1:${port}`);
});
