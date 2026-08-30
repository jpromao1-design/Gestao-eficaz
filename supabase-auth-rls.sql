-- Gestão Eficaz · Auth + RLS (usuário único / equipe autenticada)
-- Execute no Supabase: SQL Editor → New query → Run
-- Não destrói dados existentes.

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

-- 5) Garantir grants mínimos no role authenticated
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.tarefas to authenticated;

-- 6) Bloquear role anon (sem policy + revoke)
revoke all on table public.tarefas from anon;

-- Depois: Authentication → Users → Add user (email + senha)
-- Em Authentication → Providers, deixe Email habilitado.
--
-- Ressalva: a policy atual é multi-login compartilhado (qualquer
-- authenticated vê todas as tarefas). Adequado ao uso operacional
-- de usuário único / equipe pequena. Para multi-inquilino,
-- adicione user_id e filtre policies por auth.uid().
