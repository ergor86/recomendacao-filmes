import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TelaPerfis from './TelaPerfis.jsx';
import { simularFetch, erroApi, perfilExemplo, semCorpo, cabecalho } from '../apoio-testes.js';

describe('TelaPerfis', () => {
  test('aviso de perfil local e campo Apelido', async () => {
    simularFetch([['GET', '/api/perfis', []]]);
    render(<TelaPerfis onEntrar={() => {}} />);
    expect(await screen.findByText('Os perfis ficam só neste computador e não têm senha.')).toBeTruthy();
    expect(screen.getByLabelText('Apelido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver um exemplo' })).toBeTruthy();
  });

  test('criar perfil envia JSON com Content-Type e entra nele', async () => {
    const p = perfilExemplo();
    const onEntrar = vi.fn();
    const { chamadas } = simularFetch([
      ['GET', '/api/perfis', []],
      ['POST', '/api/perfis', () => new Response(JSON.stringify(p), { status: 201, headers: { 'Content-Type': 'application/json' } })],
    ]);
    render(<TelaPerfis onEntrar={onEntrar} />);
    fireEvent.change(await screen.findByLabelText('Apelido'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar perfil' }));
    await waitFor(() => expect(onEntrar).toHaveBeenCalledWith(expect.objectContaining({ id: p.id })));
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(cabecalho(post.init, 'Content-Type')).toBe('application/json');
    expect(post.init.body).toBe(JSON.stringify({ nome: 'Ana' }));
  });

  test('excluir perfil chama DELETE sem corpo e sem Content-Type', async () => {
    const p = perfilExemplo();
    let lista = [p];
    const { chamadas } = simularFetch([
      ['GET', '/api/perfis', () => lista],
      ['DELETE', `/api/perfis/${p.id}`, () => { lista = []; return semCorpo(); }],
    ]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Excluir/ }));
    expect(screen.getByText(/Apagar remove as avaliações deste perfil/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(true));
    const del = chamadas.find((c) => c.metodo === 'DELETE');
    expect(del.init.body).toBeUndefined();
    expect(cabecalho(del.init, 'Content-Type')).toBeUndefined();
  });

  test('Ver um exemplo chama POST /api/perfis/exemplo sem corpo e sem Content-Type', async () => {
    const p = perfilExemplo({ exemplo: true, nome: 'Perfil de exemplo' });
    const onEntrar = vi.fn();
    const { chamadas } = simularFetch([['GET', '/api/perfis', []], ['POST', '/api/perfis/exemplo', p]]);
    render(<TelaPerfis onEntrar={onEntrar} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver um exemplo' }));
    await waitFor(() => expect(onEntrar).toHaveBeenCalled());
    const post = chamadas.find((c) => c.metodo === 'POST');
    expect(post.url).toBe('/api/perfis/exemplo');
    expect(post.init.body).toBeUndefined();
    expect(cabecalho(post.init, 'Content-Type')).toBeUndefined();
  });

  test('renomear envia PATCH com JSON', async () => {
    const p = perfilExemplo();
    const { chamadas } = simularFetch([['GET', '/api/perfis', [p]], ['PATCH', `/api/perfis/${p.id}`, { ...p, nome: 'Bia' }]]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Renomear/ }));
    fireEvent.change(screen.getByLabelText('Novo apelido'), { target: { value: 'Bia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(true));
    expect(chamadas.find((c) => c.metodo === 'PATCH').init.body).toBe(JSON.stringify({ nome: 'Bia' }));
  });

  test('apelido só com espaços mostra uma mensagem visível e não envia', async () => {
    const { chamadas } = simularFetch([['GET', '/api/perfis', []]]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Apelido'), { target: { value: '   ' } });
    expect(screen.getByRole('alert').textContent).toContain('só com espaços');
    expect(screen.getByRole('button', { name: 'Criar perfil' }).disabled).toBe(true);
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  test('criar com nome repetido mostra a mensagem do servidor e mantém o texto', async () => {
    simularFetch([
      ['GET', '/api/perfis', []],
      ['POST', '/api/perfis', () => erroApi(409, 'NOME_EM_USO', 'Já existe um perfil com esse nome.')],
    ]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Apelido'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar perfil' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um perfil com esse nome.');
    expect(screen.getByLabelText('Apelido').value).toBe('Ana');
  });

  test('renomear para nome repetido mostra a mensagem do servidor e mantém o texto', async () => {
    const p = perfilExemplo();
    simularFetch([
      ['GET', '/api/perfis', [p]],
      ['PATCH', `/api/perfis/${p.id}`, () => erroApi(409, 'NOME_EM_USO', 'Já existe um perfil com esse nome.')],
    ]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Renomear/ }));
    fireEvent.change(screen.getByLabelText('Novo apelido'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um perfil com esse nome.');
    expect(screen.getByLabelText('Novo apelido').value).toBe('Ana');
  });

  test('renomear só com espaços mostra a mesma mensagem visível', async () => {
    const p = perfilExemplo();
    simularFetch([['GET', '/api/perfis', [p]]]);
    render(<TelaPerfis onEntrar={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: `Renomear o perfil ${p.nome}` }));
    fireEvent.change(screen.getByLabelText('Novo apelido'), { target: { value: '  ' } });
    expect(screen.getByRole('alert').textContent).toContain('só com espaços');
    expect(screen.getByRole('button', { name: 'Salvar' }).disabled).toBe(true);
  });
});
