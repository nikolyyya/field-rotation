import { useState, type ChangeEvent, type FormEvent } from 'react';
import { operationTypes, type Records, type Resource } from '../shared/types';
import type { RequestApi } from './App';
import { errorMessage } from './api';

type RecordItem = Records[Resource][number];
type FormValues = Record<string, string>;
type Option = { value: string | number; label: string };
type Control = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea';
  options?: Option[];
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
};

export const sections = {
  fields: { title: 'Поля', add: 'Добавить поле', empty: 'Добавьте первое поле.' },
  crops: { title: 'Культуры', add: 'Добавить культуру', empty: 'Добавьте первую культуру.' },
  sowings: { title: 'Посевы', add: 'Добавить посев', empty: 'Добавьте первый посев.' },
  operations: { title: 'Операции', add: 'Добавить операцию', empty: 'Добавьте первую операцию.' },
};

const formatNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function formatDate(value: string | null) {
  return value ? value.split('-').reverse().join('.') : '—';
}

function controlsFor(resource: Resource, records: Records, values: FormValues): Control[] {
  const fieldOptions = records.fields.map(({ id, name }) => ({ value: id, label: name }));
  const cropOptions = records.crops.map(({ id, name }) => ({ value: id, label: name }));
  const name = { name: 'name', label: 'Название', maxLength: 100 };
  const field: Control = { name: 'fieldId', label: 'Поле', type: 'select', options: fieldOptions };
  switch (resource) {
    case 'fields':
      return [
        name,
        { name: 'area', label: 'Площадь, га', type: 'number', min: 0.01, max: 1_000_000, step: 0.01 },
        { name: 'soilType', label: 'Тип почвы', maxLength: 100 },
      ];
    case 'crops':
      return [name];
    case 'sowings':
      return [
        field,
        { name: 'cropId', label: 'Культура', type: 'select', options: cropOptions },
        { name: 'season', label: 'Сезон (год)', type: 'number', min: 1900, max: 2200, step: 1 },
        { name: 'sowingDate', label: 'Дата посева', type: 'date' },
        { name: 'harvestDate', label: 'Дата уборки', type: 'date', optional: true },
        { name: 'yield', label: 'Урожайность, т/га', type: 'number', min: 0, max: 10_000, step: 0.01, optional: true },
      ];
    case 'operations':
      return [
        { name: 'type', label: 'Вид операции', type: 'select', options: operationTypes.map((type) => ({ value: type, label: type })) },
        { name: 'date', label: 'Дата операции', type: 'date' },
        field,
        {
          name: 'sowingId', label: 'Посев', type: 'select', optional: true,
          options: records.sowings.filter((sowing) => sowing.fieldId === Number(values.fieldId)).map((sowing) => ({
            value: sowing.id,
            label: `${sowing.season} · ${records.crops.find((crop) => crop.id === sowing.cropId)?.name ?? '—'}`,
          })),
        },
        { name: 'note', label: 'Примечание', type: 'textarea', maxLength: 1000, optional: true },
      ];
  }
}

function tableFor(resource: Resource, records: Records) {
  const fieldName = (id: number) => records.fields.find((field) => field.id === id)?.name ?? '—';
  const cropName = (id: number) => records.crops.find((crop) => crop.id === id)?.name ?? '—';
  switch (resource) {
    case 'fields':
      return {
        headers: ['Название', 'Площадь, га', 'Тип почвы'],
        rows: records.fields.map((record) => ({
          record, cells: [record.name, formatNumber.format(record.area), record.soilType],
        })),
      };
    case 'crops':
      return {
        headers: ['Название'],
        rows: records.crops.map((record) => ({ record, cells: [record.name] })),
      };
    case 'sowings':
      return {
        headers: ['Поле', 'Культура', 'Сезон', 'Дата посева', 'Дата уборки', 'Урожайность, т/га'],
        rows: records.sowings.map((record) => ({
          record,
          cells: [fieldName(record.fieldId), cropName(record.cropId), record.season, formatDate(record.sowingDate),
            formatDate(record.harvestDate), record.yield === null ? '—' : formatNumber.format(record.yield)],
        })),
      };
    case 'operations':
      return {
        headers: ['Операция', 'Дата', 'Поле', 'Посев', 'Примечание'],
        rows: records.operations.map((record) => {
          const sowing = records.sowings.find(({ id }) => id === record.sowingId);
          return {
            record,
            cells: [record.type, formatDate(record.date), fieldName(record.fieldId),
              sowing ? `${sowing.season} · ${cropName(sowing.cropId)}` : '—', record.note || '—'],
          };
        }),
      };
  }
}

function RecordForm({ resource, record, records, request, onCancel, onSave }: {
  resource: Resource;
  record: RecordItem | null;
  records: Records;
  request: RequestApi;
  onCancel: () => void;
  onSave: () => Promise<void>;
}) {
  const [values, setValues] = useState<FormValues>(() => record
    ? Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value ?? '')]))
    : { season: String(new Date().getFullYear()) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controls = controlsFor(resource, records, values);

  function change(control: Control, value: string) {
    setValues((previous) => ({
      ...previous, [control.name]: value,
      ...(control.name === 'fieldId' ? { sowingId: '' } : {}),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const body = Object.fromEntries(controls.map(({ name, type }) => {
      const value = values[name] ?? '';
      if (name === 'note') return [name, value.trim()];
      if (!value) return [name, null];
      return [name, type === 'number' || name.endsWith('Id') ? Number(value) : value];
    }));
    try {
      await request(record ? `/${resource}/${record.id}` : `/${resource}`, {
        method: record ? 'PUT' : 'POST', body,
      });
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
      return;
    }
    await onSave();
  }

  return (
    <section className="panel editor" aria-labelledby="editor-title">
      <h2 id="editor-title">{record ? 'Редактирование' : sections[resource].add}</h2>
      <form onSubmit={submit}>
        <fieldset className="form-grid" disabled={busy}>
          {controls.map((control, index) => {
            const input = {
              value: values[control.name] ?? '',
              required: !control.optional,
              onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
                change(control, event.target.value),
            };
            return (
              <label key={control.name} className={control.type === 'textarea' ? 'full-width' : undefined}>
                {control.label}{control.optional && <span className="hint"> (необязательно)</span>}
                {control.type === 'select'
                  ? <select {...input} autoFocus={index === 0}>
                    <option value="">{control.optional ? 'Без привязки' : 'Выберите…'}</option>
                    {control.options?.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  : control.type === 'textarea'
                    ? <textarea {...input} rows={3} maxLength={control.maxLength} />
                    : <input {...input} type={control.type ?? 'text'} min={control.min} max={control.max}
                      step={control.step} maxLength={control.maxLength} autoFocus={index === 0} />}
              </label>
            );
          })}
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="button primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
          <button className="button" onClick={onCancel} type="button" disabled={busy}>Отмена</button>
        </div>
      </form>
    </section>
  );
}

export function RecordPage({ resource, records, request, refresh }: {
  resource: Resource;
  records: Records;
  request: RequestApi;
  refresh: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<RecordItem | null | undefined>(undefined);
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const { headers, rows } = tableFor(resource, records);
  const section = sections[resource];
  const prerequisite = resource === 'sowings' && (!records.fields.length || !records.crops.length)
    ? 'Для добавления посева нужны поле и культура.'
    : resource === 'operations' && !records.fields.length ? 'Сначала добавьте поле.' : '';

  async function remove(record: RecordItem) {
    if (!window.confirm('Удалить эту запись?')) return;
    setRemoveId(record.id);
    setError('');
    try {
      await request(`/${resource}/${record.id}`, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRemoveId(null);
    }
  }

  return (
    <>
      <header className="page-title">
        <h1>{section.title}</h1>
        <button className="button primary" type="button"
          disabled={editor !== undefined || !!prerequisite || removeId !== null}
          onClick={() => { setError(''); setEditor(null); }}>
          {section.add}
        </button>
      </header>
      {editor !== undefined && <RecordForm resource={resource} record={editor} records={records} request={request}
        onCancel={() => setEditor(undefined)} onSave={async () => { await refresh(); setEditor(undefined); }} />}
      {error && <p className="error" role="alert">{error}</p>}
      {rows.length
        ? <div className="panel table-wrap" tabIndex={0} role="region" aria-label={section.title}>
          <table>
            <thead><tr>
              {headers.map((header) => <th scope="col" key={header}>{header}</th>)}
              <th scope="col">Действия</th>
            </tr></thead>
            <tbody>
              {rows.map(({ record, cells }) => <tr key={record.id}>
                {cells.map((cell, index) => <td key={index}>{cell}</td>)}
                <td className="row-actions">
                  <button type="button" className="text-button" disabled={editor !== undefined || removeId !== null}
                    onClick={() => { setError(''); setEditor(record); }}>Изменить</button>
                  <button type="button" className="text-button danger" disabled={editor !== undefined || removeId !== null}
                    onClick={() => void remove(record)}>{removeId === record.id ? 'Удаление…' : 'Удалить'}</button>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        : <p className="panel empty">{prerequisite || section.empty}</p>}
    </>
  );
}
