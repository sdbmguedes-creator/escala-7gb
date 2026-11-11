# Tutorial: Escala 7º GB serverless grátis (Vercel + Supabase)

Este guia é para quem não conhece programação nem servidores. Siga cada passo na ordem.

O que vamos fazer:
1. Criar um banco de dados grátis no **Supabase** (nuvem).
2. Colocar o backend (código Python) grátis na **Vercel** (nuvem).
3. Hospedar a tela do app (`index_v14.html`) na **Vercel** (mesmo lugar).
4. Importar seu backup de novembro.
5. Qualquer escalante de qualquer cidade acessa pelo navegador, sem deixar nenhuma máquina ligada em casa.

Custo: **R$ 0,00** (dentro dos limites gratuitos).

---

## Passo 1 — Criar o banco no Supabase

1. Acesse https://supabase.com e crie uma conta grátis (pode usar GitHub ou e-mail).
2. Clique em **"New Project"**.
3. Dê um nome ao projeto (ex: `escala-7gb`), escolha uma senha de banco de dados (anote-a) e escolha a região mais próxima (ex: São Paulo).
4. Aguarde o projeto ser criado (pode levar 1–2 minutos).
5. No menu esquerdo, clique em **SQL Editor**.
6. Clique em **"New query"**.
7. Abra o arquivo `supabase_schema.sql` que está na pasta `D:\CLAUDE_APP`.
8. Copie TODO o conteúdo dele e cole no campo de texto do Supabase.
9. Clique em **Run** (executar). Isso cria todas as tabelas do banco.

### Pegar as chaves do Supabase (você vai precisar delas no passo 3)

1. No menu esquerdo do Supabase, clique em **Settings** (engrenagem) -> **API**.
2. Você verá:
   - **Project URL** (algo como `https://abcdefghijklmnop.supabase.co`)
   - **anon public** (chave começa com `eyJ...`)
3. Copie esses dois valores e cole em um bloco de notas temporário. Você vai colar no Vercel depois.

---

## Passo 2 — Subir os arquivos para o GitHub (obrigatório para o Vercel)

O Vercel precisa dos arquivos em um repositório GitHub para fazer deploy automático.

1. Se não tem conta no GitHub, crie em https://github.com (grátis).
2. Crie um novo repositório (clique no `+` -> **New repository**).
   - Nome: `escala-7gb` (ou outro).
   - Deixe como **Public** (ou Private, não importa).
   - **Não** marque "Add a README file" (vamos enviar os arquivos nossos).
   - Clique em **Create repository**.
3. Você verá uma tela com instruções. Clique em **"uploading an existing file"** ou arraste os arquivos.
4. Envie TODOS os arquivos da pasta `D:\CLAUDE_APP`:
   - `index_v14.html`
   - `vercel.json`
   - `requirements.txt`
   - `supabase_schema.sql` (opcional, já rodamos no passo 1)
   - `TUTORIAL_SERVERLESS.md`
   - A pasta inteira `api/` (com todos os arquivos `.py` dentro)

5. Depois de enviar todos, clique em **Commit changes**.

---

## Passo 3 — Conectar o GitHub ao Vercel

1. Acesse https://vercel.com e crie uma conta grátis (use o mesmo GitHub).
2. Clique em **"Add New Project"**.
3. Escolha o repositório `escala-7gb` e clique em **Import**.
4. Nas configurações do projeto:
   - **Framework Preset**: deixe em "Other" ou não selecione nada específico.
   - **Build Command**: deixe em branco.
   - **Output Directory**: deixe em branco ou `.`.
   - Clique em **Deploy**.
5. Depois que terminar o deploy (1–2 minutos), o Vercel vai mostrar uma URL tipo `https://escala-7gb.vercel.app`. Anote essa URL.

### Configurar as variáveis de ambiente (SUPABASE_URL e SUPABASE_ANON_KEY)

1. No painel do Vercel, vá em **Settings** -> **Environment Variables**.
2. Adicione duas variáveis:
   - Nome: `SUPABASE_URL` | Valor: `https://seu-projeto.supabase.co` (do passo 1)
   - Nome: `SUPABASE_ANON_KEY` | Valor: `eyJ...` (a chave anon do passo 1)
3. Clique em **Save** e depois em **Redeploy** (o Vercel vai reiniciar as funções automaticamente).

---

## Passo 4 — Inicializar o Admin (fazer uma vez só)

O servidor ainda não tem um Administrador. Você precisa criar o primeiro PIN.

1. Abra o terminal (PowerShell) no seu computador.
2. Rode este comando (substitua `SUA_URL_VERCEL` pela URL que o Vercel deu):

```powershell
Invoke-WebRequest -Uri https://SUA_URL_VERCEL.vercel.app/api/setup_inicial -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"pin":"123456"}'
```

Deve retornar algo como: `{"ok":true,"perfil":"Admin"}`.

Se der erro "servidor já inicializado", ignore — o Admin já existe.

O PIN padrão é **123456**. Você pode mudar depois.

---

## Passo 5 — Importar seu backup de novembro

O banco está vazio. Você vai importar o arquivo `escala-2026-11_OK_SYNC.json` que você já tem.

Crie um arquivo temporário chamado `importar_supabase.py` (qualquer lugar do seu computador):

```python
#!/usr/bin/env python3
import os, sys, json, urllib.request, urllib.error

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

def sb_request(method, path, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        import urllib.parse
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8")
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        print("ERRO:", e.code, e.read().decode("utf-8"))
        raise

def main():
    if len(sys.argv) < 2:
        print("Uso: python importar_supabase.py escala-2026-11_OK_SYNC.json")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        dados = json.load(f)

    competencia = str(dados.get("competencia", "2026-11"))[:7]
    agora = __import__("datetime").datetime.utcnow().isoformat() + "Z"

    # Elenco
    elenco = []
    for m in dados.get("mes", []):
        if not m.get("id"):
            continue
        elenco.append({
            "competencia": competencia,
            "militar_id": m["id"],
            "secao": m.get("secao", "") or "",
            "escala": m.get("escala", "") or "",
            "motorista": m.get("motorista", "") or "",
            "adm": m.get("adm", "") or "",
            "restricao": bool(m.get("restricao")),
            "cotas_adm": int(m.get("cotasAdm", 0) or 0),
            "afast_json": m.get("afast") or [],
            "escala_origem": m.get("escalaOrigem", "") or "",
            "escala_origem_adm": m.get("escalaOrigemAdm", "") or "",
        })

    # Marcas
    marcas = []
    for chave, codigo in (dados.get("marks") or {}).items():
        if not codigo:
            continue
        partes = str(chave).split("|")
        if len(partes) < 3:
            continue
        marcas.append({
            "competencia": competencia,
            "grupo": partes[0],
            "militar_id": partes[1],
            "dia": partes[2],
            "codigo": codigo,
            "ts": agora,
            "autor": "importacao",
        })

    # ACO oficiais
    aco = []
    for dia, turnos in (dados.get("acoOficiais") or {}).items():
        for turno in ("t1", "t2"):
            aco.append({
                "competencia": competencia,
                "dia": dia,
                "turno": turno,
                "oficial": turnos.get(turno, "") or "",
            })

    # Movimentos
    movimentos = []
    for mv in (dados.get("movimentos") or []):
        movimentos.append({
            "competencia": competencia,
            "quando": mv.get("quando", "") or "",
            "tipo": mv.get("tipo", "") or "",
            "origem": mv.get("origem", "") or "",
            "destino": mv.get("destino", "") or "",
            "qtd": mv.get("qtd", 0),
            "motivo": mv.get("motivo", "") or "",
            "autor": mv.get("autor", "importacao") or "importacao",
        })

    # Oficiais
    oficiais = [{"nome": n, "ativo": True} for n in (dados.get("oficiais") or []) if n]

    # Meta + extras
    extras = {
        "vis": dados.get("vis", {}),
        "aco": dados.get("aco", []),
        "feriados": dados.get("feriados", []),
        "fem": dados.get("fem", {}),
        "visLinhas": dados.get("visLinhas", {}),
        "snapshot": dados.get("snapshot"),
        "removidos": dados.get("removidos", {}),
        "confFixos": dados.get("confFixos", []),
        "ordemPessoas": dados.get("ordemPessoas", {}),
        "autoX": dados.get("autoX", True),
    }
    params = dados.get("params", {})
    status = dados.get("statusMes", "ativa")

    print("Enviando dados para o Supabase...")

    # Limpar competencia existente (se houver)
    for tabela in ["marcas", "comments", "elenco", "aco_oficiais", "movimentos", "meta"]:
        try:
            sb_request("DELETE", tabela, params={"competencia": f"eq.{competencia}"})
        except Exception as e:
            print(f"Aviso: não pôde limpar {tabela}: {e}")

    # Inserir
    sb_request("POST", "elenco", body=elenco)
    sb_request("POST", "marcas", body=marcas)
    sb_request("POST", "aco_oficiais", body=aco)
    sb_request("POST", "movimentos", body=movimentos)
    sb_request("POST", "oficiais", body=oficiais)
    sb_request("POST", "meta", body=[{
        "competencia": competencia,
        "versao": 1,
        "status": status,
        "params_json": params,
        "snapshot_json": None,
        "extras_json": extras,
        "atualizado_em": agora,
        "atualizado_por": "importacao",
    }])

    print("Importação concluída!")
    print(f"  Elenco: {len(elenco)}")
    print(f"  Marcas: {len(marcas)}")
    print(f"  ACO oficiais: {len(aco)}")
    print(f"  Movimentos: {len(movimentos)}")
    print(f"  Oficiais: {len(oficiais)}")

if __name__ == "__main__":
    main()
```

Para rodar:

```powershell
$env:SUPABASE_URL="https://seu-projeto.supabase.co"
$env:SUPABASE_ANON_KEY="eyJ..."
python importar_supabase.py escala-2026-11_OK_SYNC.json
```

Ou, se estiver no Linux/Mac:

```bash
export SUPABASE_URL="https://seu-projeto.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."
python importar_supabase.py escala-2026-11_OK_SYNC.json
```

Deve mostrar algo como:
```
Enviando dados para o Supabase...
Importação concluída!
  Elenco: 110
  Marcas: 968
  ACO oficiais: 46
  Movimentos: 0
  Oficiais: 8
```

---

## Passo 6 — Acessar o app

Acesse no navegador:

```
https://SUA_URL_VERCEL.vercel.app/index_v14.html
```

Na tela de abertura, digite o PIN: **123456**.

Pronto. Você está usando o backend serverless na nuvem. Qualquer pessoa de qualquer cidade pode acessar a mesma URL e ver os mesmos dados.

---

## Como criar outros usuários (escalantes)

Só o Admin pode criar usuários. Depois de logar como Admin no app, você pode usar a tela de usuários (se houver) ou chamar direto pela API:

```powershell
Invoke-WebRequest -Uri https://SUA_URL_VERCEL.vercel.app/api/criar_usuario -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"token":"SEU_TOKEN","nome":"FULANO","perfil":"1ªSB","pin":"654321"}'
```

O `SEU_TOKEN` você obtém fazendo login primeiro (`/api/login` com o PIN do Admin).

---

## Limitações do plano gratuito

| Recurso | Limite grátis | O que significa para você |
|---------|--------------|--------------------------|
| Supabase banco | 500 MB | Suficiente para milhares de marcas e anos de dados |
| Vercel funções | 100 GB/h de execução | Muito para uso de escala de bombeiros |
| Acessos simultâneos | ilimitado (razoável) | Vários escalantes podem usar ao mesmo tempo |
| Banco SQLite → PostgreSQL | já é PostgreSQL | Não trava com SQLite, suporta concorrência melhor |

---

## Se algo der errado

1. **Erro CORS**: certifique-se de que as variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` estão configuradas no Vercel e que você fez Redeploy.
2. **Token inválido**: o PIN pode estar errado ou a sessão expirou. Faça login novamente.
3. **Banco vazio**: você esqueceu de importar o JSON (Passo 5).
4. **404 na URL**: verifique se os arquivos da pasta `api/` foram enviados para o GitHub e o Vercel fez o deploy com sucesso.

---

## Arquivos criados nesta sessão

| Arquivo | O que é |
|---------|---------|
| `api/supabase_client.py` | Cliente que fala com o Supabase |
| `api/utils.py` | Utilitários de resposta JSON e CORS |
| `api/setup_inicial.py` | Cria o Admin inicial (PIN) |
| `api/login.py` | Login com PIN de 6 dígitos |
| `api/logout.py` | Encerra sessão |
| `api/status.py` | Status do servidor |
| `api/pull.py` | Baixa dados de uma competência |
| `api/push.py` | Envia alterações (escala, marcas, ACO) |
| `api/bootstrap.py` | Dados iniciais ao abrir o mês |
| `api/listar_usuarios.py` | Lista usuários (só Admin) |
| `api/criar_usuario.py` | Cadastra novo escalante |
| `api/revogar_usuario.py` | Remove acesso de usuário |
| `api/redefinir_pin.py` | Troca PIN de alguém |
| `api/encerrar_sessoes.py` | Força logout de usuários |
| `vercel.json` | Configuração de deploy na Vercel |
| `requirements.txt | Dependências Python (nenhuma externa) |
| `supabase_schema.sql` | Script SQL para criar tabelas no Supabase |
| `TUTORIAL_SERVERLESS.md` | Este tutorial |

Tudo está em `D:\CLAUDE_APP`. Qualquer dúvida, é só chamar.
