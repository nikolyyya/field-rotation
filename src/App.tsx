import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Records, Resource } from '../shared/types';
import { ApiError, api, errorMessage, type Session } from './api';
import { RecordPage, sections } from './RecordPage';

const Statistics = lazy(() => import('./Statistics'));

type Page = Resource | 'stats';
const navigation: Page[] = ['fields', 'crops', 'sowings', 'operations', 'stats'];
const sessionKey = 'field-rotation-session';

function getSession(): Session | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
    return typeof stored?.email === 'string' && typeof stored.token === 'string' ? stored : null;
  } catch {
    return null;
  }
}

function AuthPage({ onSuccess }: { onSuccess: (value: Session) => void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSuccess(await api<Session>(register ? '/register' : '/login', {
        method: 'POST',
        body: { email, password },
      }));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="panel auth-panel" aria-labelledby="auth-title">
        <p className="brand">Полевой журнал</p>
        <h1 id="auth-title">{register ? 'Регистрация' : 'Вход'}</h1>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Электронная почта
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)}
              autoComplete="email" maxLength={254} required />
          </label>
          <label>
            Пароль {register && <span className="hint">(от 8 символов)</span>}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>
            {busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>
        <button className="text-button" type="button" disabled={busy} onClick={() => {
          setRegister(!register);
          setError('');
          setPassword('');
        }}>
          {register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
      </section>
    </main>
  );
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('fields');
  const [records, setRecords] = useState<Records | null>(null);
  const [loadError, setLoadError] = useState('');
  const latestRequest = useRef(0);
  const request = useCallback(async <T,>(path: string, options?: { method: string; body?: object }) => {
    try {
      return await api<T>(path, { ...options, token: session.token });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogout();
      throw error;
    }
  }, [session.token, onLogout]);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoadError('');
    try {
      const result = await request<Records>('/records');
      if (requestId === latestRequest.current) setRecords(result);
    } catch (error) {
      if (requestId === latestRequest.current) setLoadError(errorMessage(error));
    }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="workspace">
      <aside className="sidebar">
        <p className="brand">Полевой журнал</p>
        <nav aria-label="Разделы журнала">
          {navigation.map((item) => (
            <button key={item} type="button" aria-current={item === page ? 'page' : undefined}
              onClick={() => setPage(item)}>
              {item === 'stats' ? 'Статистика' : sections[item].title}
            </button>
          ))}
        </nav>
        <div className="account">
          <span>{session.email}</span>
          <button type="button" className="button" onClick={onLogout}>Выйти</button>
        </div>
      </aside>
      <main className="content">
        {loadError && (
          <div className="load-error">
            <p className="error" role="alert">{loadError}</p>
            <button className="button" onClick={() => void refresh()}>Повторить</button>
          </div>
        )}
        {!records && !loadError && <p role="status">Загрузка журнала…</p>}
        {records && (page === 'stats'
          ? <Suspense fallback={<p role="status">Загрузка статистики…</p>}>
            <Statistics sowings={records.sowings} request={request} />
          </Suspense>
          : <RecordPage key={page} resource={page} records={records} request={request} refresh={refresh} />)}
      </main>
    </div>
  );
}

export type RequestApi = <T>(path: string, options?: { method: string; body?: object }) => Promise<T>;

export function App() {
  const [session, setSession] = useState<Session | null>(getSession);
  const logout = useCallback(() => {
    sessionStorage.removeItem(sessionKey);
    setSession(null);
  }, []);

  if (session) return <Workspace session={session} onLogout={logout} />;
  return <AuthPage onSuccess={(value) => {
    sessionStorage.setItem(sessionKey, JSON.stringify(value));
    setSession(value);
  }} />;
}

