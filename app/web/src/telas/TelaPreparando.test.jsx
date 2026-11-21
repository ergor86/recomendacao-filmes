import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TelaPreparando from './TelaPreparando.jsx';
import { simularFetch, perfilExemplo } from '../apoio-testes.js';

describe('TelaPreparando', () => {
  test('mostra etapa 3 de 8', () => {
    render(<TelaPreparando saude={{ estado: 'preparando', etapa: 3, total: 8, mensagem: 'Importando as notas', perfis: { disponivel: false, motivo: 'sem_dados' } }} onConferir={() => {}} />);
    expect(screen.getByText('Etapa 3 de 8')).toBeTruthy();
    expect(screen.getByText('Importando as notas')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  test('bloqueado + perfis.disponivel mostra o link Apagar perfis e avaliações', () => {
    const onConferir = vi.fn();
    render(<TelaPreparando saude={{ estado: 'bloqueado', causa: 'Os dados não conferem.', comando: 'docker compose run --rm preparar', perfis: { disponivel: true } }} onConferir={onConferir} />);
    expect(screen.getByRole('link', { name: 'Apagar perfis e avaliações' })).toBeTruthy();
    expect(screen.getByText('Os dados não conferem.')).toBeTruthy();
    expect(screen.getByText('docker compose run --rm preparar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conferir de novo' }));
    expect(onConferir).toHaveBeenCalledTimes(1);
  });

  test('perfis indisponível mostra o texto com down -v', () => {
    const { container } = render(<TelaPreparando saude={{ estado: 'falhou', causa: 'x', perfis: { disponivel: false, motivo: 'banco_indisponivel' } }} onConferir={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Apagar perfis e avaliações' })).toBeNull();
    const t = container.textContent;
    expect(t).toContain('Agora não é possível apagar perfis:');
    expect(t).toContain('Para apagar tudo, use docker compose down -v (isso também apaga a preparação).');
  });

  test('o link abre a gestão restrita e o botão Voltar retorna', async () => {
    simularFetch([['GET', '/api/perfis', [perfilExemplo()]]]);
    render(<TelaPreparando saude={{ estado: 'preparando', etapa: 1, total: 8, perfis: { disponivel: true } }} onConferir={() => {}} />);
    fireEvent.click(screen.getByRole('link', { name: 'Apagar perfis e avaliações' }));
    expect(await screen.findByText('Ana')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.getByText('Etapa 1 de 8')).toBeTruthy());
  });
});
