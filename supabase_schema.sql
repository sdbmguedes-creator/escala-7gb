-- supabase_schema.sql
-- Execute este SQL no SQL Editor do seu projeto Supabase.
-- https://app.supabase.com -> seu projeto -> SQL Editor

-- Propriedades (setup, throttles)
create table if not exists propriedades (
  chave text primary key,
  valor text
);

-- Usuários (Admin, Mestre, 1ªSB...4ªSB)
create table if not exists usuarios (
  nome text primary key,
  perfil text,
  pin_hash text,
  salt text,
  ativo boolean default true,
  tentativas integer default 0,
  bloqueado_ate timestamptz
);

-- Sessões (token, expiração, ativo)
create table if not exists sessoes (
  token text primary key,
  perfil text,
  nome text,
  criado_em timestamptz default now(),
  expira_em timestamptz,
  ativo boolean default true
);

-- Marcas (escala diária por militar)
create table if not exists marcas (
  id bigserial primary key,
  competencia text,
  grupo text,
  militar_id text,
  dia text,
  codigo text,
  ts timestamptz default now(),
  autor text,
  unique(competencia, grupo, militar_id, dia)
);

-- Comentários
create table if not exists comments (
  id bigserial primary key,
  competencia text,
  chave text,
  texto text,
  ts timestamptz default now(),
  autor text,
  unique(competencia, chave)
);

-- Elenco (militares da competência)
create table if not exists elenco (
  id bigserial primary key,
  competencia text,
  militar_id text,
  secao text,
  escala text,
  motorista text,
  adm text,
  restricao boolean default false,
  cotas_adm integer default 0,
  afast_json jsonb default '[]'::jsonb,
  escala_origem text,
  escala_origem_adm text,
  unique(competencia, militar_id)
);

-- ACO oficiais por dia/turno
create table if not exists aco_oficiais (
  id bigserial primary key,
  competencia text,
  dia text,
  turno text,
  oficial text,
  unique(competencia, dia, turno)
);

-- Movimentos (remessa, transferência, etc.)
create table if not exists movimentos (
  id bigserial primary key,
  competencia text,
  quando text,
  tipo text,
  origem text,
  destino text,
  qtd real,
  motivo text,
  autor text
);

-- Meta da competência (versão, params, vis, aco)
create table if not exists meta (
  competencia text primary key,
  versao integer default 0,
  status text default 'ativa',
  params_json jsonb,
  snapshot_json jsonb,
  extras_json jsonb,
  atualizado_em timestamptz default now(),
  atualizado_por text
);

-- Log de ações
create table if not exists log (
  id bigserial primary key,
  ts timestamptz default now(),
  autor text,
  acao text,
  alvo text,
  detalhe text
);

-- Oficiais disponíveis para ACO
create table if not exists oficiais (
  nome text primary key,
  ativo boolean default true
);

-- Desabilitar RLS para simplificar (em produção, configure políticas adequadas)
alter table propriedades disable row level security;
alter table usuarios disable row level security;
alter table sessoes disable row level security;
alter table marcas disable row level security;
alter table comments disable row level security;
alter table elenco disable row level security;
alter table aco_oficiais disable row level security;
alter table movimentos disable row level security;
alter table meta disable row level security;
alter table log disable row level security;
alter table oficiais disable row level security;
