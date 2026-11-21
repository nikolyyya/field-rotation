export const operationTypes = [
  'Обработка почвы',
  'Посев',
  'Внесение удобрений',
  'Полив',
  'Обработка от вредителей',
  'Уборка урожая',
  'Другое',
] as const;

export interface Field {
  id: number;
  name: string;
  area: number;
  soilType: string;
}

export interface Crop {
  id: number;
  name: string;
}

export interface Sowing {
  id: number;
  fieldId: number;
  cropId: number;
  season: number;
  sowingDate: string;
  harvestDate: string | null;
  yield: number | null;
}

export interface Operation {
  id: number;
  type: (typeof operationTypes)[number];
  date: string;
  fieldId: number;
  sowingId: number | null;
  note: string;
}

export interface Records {
  fields: Field[];
  crops: Crop[];
  sowings: Sowing[];
  operations: Operation[];
}

export type Resource = keyof Records;

export interface Stats {
  areas: { crop: string; area: number }[];
  yields: { season: number; yield: number }[];
}

