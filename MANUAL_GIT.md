═══════════════════════════════════════════════════════════════════════════════

8\) MANUAL DE GIT / DEPLOY — FLUXO OBRIGATÓRIO (BRANCH PROTEGIDA)

═══════════════════════════════════════════════════════════════════════════════



A branch 'main' tem "Branch Protection Rule" no GitHub. Push direto nela é

BLOQUEADO. Todo trabalho passa por Pull Request + CI verde (Pytest + Cypress)

antes do merge. Não é burocracia — já evitou subir código quebrado em produção.



O deploy em https://escala-7gb.vercel.app é automático: dispara \~2 min após

o merge na 'main'. Não existe passo manual de deploy.





───────────────────────────────────────────────────────────────────────────────

8.1) O CICLO COMPLETO (6 PASSOS — MEMORIZE)

───────────────────────────────────────────────────────────────────────────────



&#x20;  1. git status                                  → ver o que mudou

&#x20;  2. git checkout -b nome-da-branch              → sair da main

&#x20;  3. git add . \&\& git commit -m "mensagem"       → empacotar mudanças

&#x20;  4. git push origin nome-da-branch              → subir branch

&#x20;  5. Abrir PR no GitHub → esperar CI verde → Merge

&#x20;  6. git checkout main \&\& git pull origin main   → voltar e sincronizar



&#x20;  ⚠️  O PASSO 6 É OBRIGATÓRIO. Sem ele, o 'main' local fica congelado no

&#x20;      dia em que você criou a branch. Na próxima tarefa você cria branch

&#x20;      a partir de um main velho, e o merge dá conflito ou (pior) reverte

&#x20;      algo sem perceber.



&#x20;  ⚠️  O PASSO 2 SÓ ACONTECE UMA VEZ POR TAREFA. Se você já está na branch

&#x20;      de trabalho, pule direto para os passos 3 e 4 — commit + push

&#x20;      adicionam ao PR existente automaticamente.





───────────────────────────────────────────────────────────────────────────────

8.2) VERSÃO CURTA (O QUE VOCÊ VAI FAZER 90% DAS VEZES)

───────────────────────────────────────────────────────────────────────────────



&#x20;  # ── Início de tarefa nova ─────────────────────────────────────────────

&#x20;  git checkout main

&#x20;  git pull origin main

&#x20;  git checkout -b fix/descricao-curta



&#x20;  # ── ... edita arquivos no VS Code ... ─────────────────────────────────



&#x20;  git status

&#x20;  git add .

&#x20;  git commit -m "fix: descrição objetiva do que mudou"

&#x20;  git push origin fix/descricao-curta



&#x20;  # ── Abre PR no GitHub → espera CI → Merge → "Delete branch" ───────────



&#x20;  # ── Depois ────────────────────────────────────────────────────────────

&#x20;  git checkout main

&#x20;  git pull origin main





───────────────────────────────────────────────────────────────────────────────

8.3) CONVENÇÃO DE NOMES DE BRANCH

───────────────────────────────────────────────────────────────────────────────



&#x20;  Prefixo     Quando usar                            Exemplo

&#x20;  ───────     ──────────────────────────────         ────────────────────────

&#x20;  fix/        Correção de bug                        fix/sync-race

&#x20;  feat/       Nova funcionalidade                    feat/notificacoes-push

&#x20;  refactor/   Reorganização sem mudar comportamento  refactor/sync-flush

&#x20;  docs/       Só documentação                        docs/manual-git

&#x20;  chore/      Config, CI, dependências               chore/atualiza-cypress



&#x20;  Não é obrigatório, mas quando você volta ao projeto em 3 semanas e vê

&#x20;  'git branch -a', saber o que cada branch faz evita arqueologia.





───────────────────────────────────────────────────────────────────────────────

8.4) CHECKLIST ANTES DE CADA PUSH

───────────────────────────────────────────────────────────────────────────────



&#x20;  □ Estou NA BRANCH certa?       → git branch --show-current

&#x20;  □ Estou na main sem querer?    → PARE. git checkout -b nome-novo

&#x20;  □ git status mostra só o que quero commitar?  → se tem lixo (.bak, .log,

&#x20;                                                  \_\_pycache\_\_), adicione ao

&#x20;                                                  .gitignore antes

&#x20;  □ A mensagem do commit descreve O QUE mudou, não "update" ou "fix"?

&#x20;  □ O CI pode falhar? → rode local ANTES:

&#x20;       python -m pytest api/tests/ -v       (backend)

&#x20;       npx cypress run --browser chrome     (frontend)





───────────────────────────────────────────────────────────────────────────────

8.5) PROBLEMAS COMUNS E COMO RESOLVER

───────────────────────────────────────────────────────────────────────────────



&#x20;  ❌ "fatal: a branch named 'fix/xyz' already exists"

&#x20;     Você já criou essa branch antes. Ou entre nela, ou use outro nome:

&#x20;        git checkout fix/xyz



&#x20;  ❌ "Your branch and 'origin/main' have diverged"

&#x20;     Seu main local tem commit que o remoto não tem (ou vice-versa).

&#x20;     ⚠️  NUNCA force push. Resolva com rebase:

&#x20;        git pull origin main --rebase

&#x20;     Se der conflito, abra o arquivo no VS Code (marcadores <<<<<<<), escolha

&#x20;     a versão que fica, salve, depois:

&#x20;        git add .

&#x20;        git rebase --continue



&#x20;  ❌ "Your local changes would be overwritten by checkout"

&#x20;     Tem alteração não commitada e o git recusa trocar de branch.

&#x20;     ⚠️  NUNCA use --force. Escolha:

&#x20;        - Commitar:   git add . \&\& git commit -m "wip: ..."

&#x20;        - Guardar:    git stash  →  checkout  →  git stash pop



&#x20;  ❌ "Merge conflict" no PR do GitHub

&#x20;     Dois cenários:

&#x20;     a) Alguém mergeou antes de você → botão "Resolve conflicts" no GitHub

&#x20;        (interface web) ou local: git pull origin main na sua branch, resolve,

&#x20;        commit, push

&#x20;     b) Você mergeou outra branch antes → mesmo processo



&#x20;  ❌ Push bloqueado: "GH006: Protected branch update failed"

&#x20;     É a branch protection funcionando. Crie branch + PR (ver 8.1).

&#x20;     Não tente forçar — o bloqueio existe para evitar produção quebrada.



&#x20;  ❌ CI vermelho no PR

&#x20;     Clique em "Details" no check que falhou → vê o log do erro → corrige

&#x20;     local → commit + push na MESMA branch → CI roda de novo automaticamente.





───────────────────────────────────────────────────────────────────────────────

8.6) ACELERADOR OPCIONAL — GITHUB CLI

───────────────────────────────────────────────────────────────────────────────



&#x20;  Instalar (uma vez só):

&#x20;     winget install GitHub.cli

&#x20;     gh auth login



&#x20;  Depois, ciclo inteiro sem abrir navegador:

&#x20;     git checkout main \&\& git pull origin main

&#x20;     git checkout -b fix/descricao-curta

&#x20;     # ... edita ...

&#x20;     git add . \&\& git commit -m "fix: ..."

&#x20;     git push -u origin fix/descricao-curta

&#x20;     gh pr create --fill              # abre PR com título/descrição do commit

&#x20;     gh pr checks --watch             # espera CI verde (opcional)

&#x20;     gh pr merge --squash --delete-branch   # merge + apaga branch





───────────────────────────────────────────────────────────────────────────────

8.7) REGRAS DE OURO

───────────────────────────────────────────────────────────────────────────────



&#x20;  1. NUNCA push direto na main. Sempre branch + PR.

&#x20;  2. NUNCA git push --force em branch remota (protegida ou não).

&#x20;  3. SEMPRE git checkout main \&\& git pull depois de mergear.

&#x20;  4. SEMPRE rodar Pytest/Cypress local antes do push quando o CI é exigido.

&#x20;  5. SEMPRE confirmar em qual branch você está antes de editar arquivos

&#x20;     críticos (api/app.py, index\_v14.html).

&#x20;  6. Backup antes de mudanças em produção. Já está nas lições aprendidas,

&#x20;     mas vale reforçar: git status + commit frequente = rede de segurança.

&#x20;  7. Se o CI falhar 3x na mesma branch, é sinal de que o escopo da mudança

&#x20;     é grande demais. Considere quebrar em PRs menores.





───────────────────────────────────────────────────────────────────────────────

8.8) MOMENTO DO DEPLOY (APÓS O MERGE)

───────────────────────────────────────────────────────────────────────────────



&#x20;  Após o merge na 'main', ACONTECEM EM PARALELO:



&#x20;  ┌─ Vercel ──────────────────────────────────────────────────────────────┐

&#x20;  │  Build + deploy automático do backend (api/app.py) e do frontend     │

&#x20;  │  (index\_v14.html). Tempo típico: 1–2 min.                             │

&#x20;  │                                                                       │

&#x20;  │  Status: aba "Deployments" do projeto no Vercel Dashboard.           │

&#x20;  │  Se vermelho → clique no deployment → "Build Logs".                  │

&#x20;  └───────────────────────────────────────────────────────────────────────┘



&#x20;  ┌─ GitHub Actions ──────────────────────────────────────────────────────┐

&#x20;  │  Roda Pytest + Cypress de novo na 'main' (redundância pós-merge).    │

&#x20;  │  Se falhar AQUI mas passou no PR → algum problema de timing/ambiente.│

&#x20;  │  Investigue imediatamente — pode indicar que produção está afetada.  │

&#x20;  └───────────────────────────────────────────────────────────────────────┘



&#x20;  Confirmar deploy em produção:

&#x20;     Abrir https://escala-7gb.vercel.app

&#x20;     F12 → Console → rodar: BUILD\_APP

&#x20;     Deve retornar a versão nova (ex: "v14-2026-11-20" se você bumpou).





───────────────────────────────────────────────────────────────────────────────

8.9) ANATOMIA DO FLUXO (VISÃO GERAL)

───────────────────────────────────────────────────────────────────────────────



&#x20;     ┌──────────────┐

&#x20;     │  main local  │──git pull──▶ atualizado

&#x20;     └──────┬───────┘

&#x20;            │ git checkout -b fix/xyz

&#x20;            ▼

&#x20;     ┌──────────────┐

&#x20;     │ fix/xyz      │◀── VS Code: edita arquivos

&#x20;     └──────┬───────┘

&#x20;            │ git add . \&\& git commit -m "..."

&#x20;            │ git push origin fix/xyz

&#x20;            ▼

&#x20;     ┌──────────────┐

&#x20;     │ GitHub       │──CI roda (Pytest + Cypress)

&#x20;     │              │──PR aberto

&#x20;     └──────┬───────┘

&#x20;            │ CI verde + merge

&#x20;            ▼

&#x20;     ┌──────────────┐

&#x20;     │ main remota  │──Vercel deploya em \~2 min

&#x20;     │              │──Actions roda de novo (redundância)

&#x20;     └──────┬───────┘

&#x20;            │ git checkout main \&\& git pull

&#x20;            ▼

&#x20;     ┌──────────────┐

&#x20;     │  main local  │──pronto para próxima tarefa

&#x20;     └──────────────┘



═══════════════════════════════════════════════════════════════════════════════

