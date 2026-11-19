# Documentação do Banco de Dados e Políticas RLS (Supabase) - Projeto Escala 7º GB

Este documento descreve a estrutura do banco de dados PostgreSQL utilizado no Supabase para o projeto de escalas do 7º GB, incluindo tabelas principais, funções, visões e políticas de segurança (Row Level Security - RLS).

---

## 1. Visão Geral
O banco de dados gerencia efetivos militares, escalas de serviço, impedimentos, folgas, plantões extraordinários (PJES) e configurações operacionais.

---

## 2. Tabelas Principais (Esquema `public`)

### `militares`
Armazena o cadastro do efetivo.
- `id` (UUID / Primary Key)
- `posto_grad` (VARCHAR): Posto ou graduação do militar.
- `nome_guerra` (VARCHAR): Nome de guerra para identificação rápida.
- `rg` (VARCHAR): Registro geral ou funcional.
- `ativo` (BOOLEAN): Status operacional do militar.

### `escala_servico`
Registra os plantões e serviços atribuídos por dia.
- `id` (UUID / Primary Key)
- `militar_id` (UUID / Foreign Key -> `militares.id`)
- `data` (DATE): Data do serviço.
- `tipo_servico` (VARCHAR): Sigla/tipo do serviço (ex: EQ, P2, etc.).

### `impedimentos`
Registra férias, licenças e afastamentos.
- `id` (UUID / Primary Key)
- `militar_id` (UUID / Foreign Key -> `militares.id`)
- `data_inicio` (DATE)
- `data_fim` (DATE)
- `motivo` (VARCHAR)

---

## 3. Row Level Security (RLS)

O Supabase protege todas as tabelas através de políticas RLS ativadas por padrão:
- **Leitura (SELECT)**: Permitida para usuários autenticados da corporação.
- **Escrita (INSERT/UPDATE/DELETE)**: Restrita a administradores e oficiais de dia com privilégios elevados.

---

## 4. Scripts Relacionados
- O esquema SQL completo pode ser encontrado no arquivo `supabase_schema.sql` na raiz do repositório.
- O client Python auxiliar para integração se encontra em `supabase_client.py`.
