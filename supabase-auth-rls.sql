-- Gestão Eficaz · Auth + RLS (usuário único)
-- Execute no Supabase: SQL Editor → New query → Run

-- 1) Coluna opcional de conclusão (se ainda não existir)
alter table public.tarefas
  add column if not exists "completedAt" timestamptz;

-- 2) Ativar Row Level Security
alter table public.tarefas enable row level security;

-- 3) Remover policies antigas (se existirem) para recriar limpas
drop policy if exists "anon full access" on public.tarefas;
drop policy if exists "authenticated full access" on public.tarefas;
drop policy if exists "Permitir tudo autenticado" on public.tarefas;

-- 4) Apenas usuários autenticados podem ler/escrever
create policy "authenticated full access"
  on public.tarefas
  for all
  to authenticated
  using (true)
  with check (true);

-- 5) Garantir que anon NÃO tenha acesso (sem policy = bloqueado com RLS on)
-- Não crie policy para o role "anon".

-- Depois: Authentication → Users → Add user (email + senha)
-- Em Authentication → Providers, deixe Email habilitado.
