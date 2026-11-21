// Preparação do Vitest: limpa o DOM e o localStorage entre os testes.
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try { window.localStorage.clear(); } catch { /* ignorado */ }
});
