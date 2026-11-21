import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Sowing, Stats } from '../shared/types';
import type { RequestApi } from './App';
import { errorMessage } from './api';

const formatNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const tick = { fill: '#52635a', fontSize: 14 };
const green = '#34734d';

export default function Statistics({ sowings, request }: { sowings: Sowing[]; request: RequestApi }) {
  const seasons = [...new Set(sowings.map(({ season }) => season))].sort((a, b) => b - a);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const season = selectedSeason !== null && seasons.includes(selectedSeason) ? selectedSeason : seasons[0];

  return (
    <>
      <header className="page-title">
        <h1>Статистика</h1>
        {season !== undefined && (
          <label className="season-select">
            Сезон для площадей
            <select value={season} onChange={(event) => setSelectedSeason(Number(event.target.value))}>
              {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        )}
      </header>
      {season === undefined
        ? <p className="panel empty">Добавьте посевы, чтобы увидеть статистику.</p>
        : <Charts key={season} season={season} request={request} />}
    </>
  );
}

function Charts({ season, request }: { season: number; request: RequestApi }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    request<Stats>(`/stats?season=${season}`)
      .then((result) => { if (active) setStats(result); })
      .catch((error) => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [request, season, attempt]);

  if (error) {
    return (
      <div className="load-error">
        <p className="error" role="alert">{error}</p>
        <button className="button" onClick={() => { setError(''); setAttempt(attempt + 1); }}>Повторить</button>
      </div>
    );
  }
  if (!stats) return <p role="status">Загрузка статистики…</p>;

  return (
    <div className="chart-grid">
      <section className="panel chart-panel" aria-labelledby="areas-title">
        <h2 id="areas-title">Посевные площади по культурам, га</h2>
        <p className="hint">Всего за {season} год — {formatNumber.format(stats.areas.reduce((sum, row) => sum + row.area, 0))} га</p>
        {stats.areas.length
          ? <ResponsiveContainer width="100%" height={Math.max(260, stats.areas.length * 36 + 44)}>
            <BarChart data={stats.areas} layout="vertical" margin={{ right: 14, left: 4 }} accessibilityLayer>
              <CartesianGrid stroke="#e5ebe6" horizontal={false} />
              <XAxis type="number" tick={tick} />
              <YAxis type="category" dataKey="crop" width={105} tick={tick}
                tickFormatter={(name: string) => name.length > 14 ? `${name.slice(0, 13)}…` : name} />
              <Tooltip formatter={(value) => [`${formatNumber.format(Number(value))} га`, 'Площадь']} />
              <Bar dataKey="area" fill={green} barSize={22} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          : <p className="empty">В этом сезоне нет посевов.</p>}
      </section>
      <section className="panel chart-panel" aria-labelledby="yields-title">
        <h2 id="yields-title">Урожайность по годам, т/га</h2>
        <p className="hint">Средняя урожайность с учётом площади полей</p>
        {stats.yields.length
          ? <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.yields} margin={{ right: 16, left: 0, top: 8 }} accessibilityLayer>
              <CartesianGrid stroke="#e5ebe6" vertical={false} />
              <XAxis dataKey="season" tick={tick} />
              <YAxis width={42} tick={tick} domain={[0, 'auto']} />
              <Tooltip labelFormatter={(value) => `Сезон ${value}`}
                formatter={(value) => [`${formatNumber.format(Number(value))} т/га`, 'Урожайность']} />
              <Line dataKey="yield" stroke={green} strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
          : <p className="empty">Укажите урожайность хотя бы в одном посеве.</p>}
      </section>
    </div>
  );
}

