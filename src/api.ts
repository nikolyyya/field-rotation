export interface Session {
  email: string;
  token: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: object; token?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Не удалось подключиться к серверу.');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(response.status, error?.message ?? 'Сервер не смог выполнить запрос.');
  }
  return response.status === 204 ? (undefined as T) : (await response.json() as T);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Произошла ошибка.';
}

