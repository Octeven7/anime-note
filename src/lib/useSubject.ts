import { api, useRemote } from './api';
import type { Subject } from '../types';

export function useSubject(id: string) {
  return useRemote<Subject>(id, (signal) => api(`/api/catalog/${id}`, { signal }));
}
