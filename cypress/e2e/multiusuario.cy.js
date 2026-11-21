// Ciclo completo multiusuario no navegador, sem rede externa:
// login -> pull -> edicao (Usuario A) -> push -> Usuario B grava no servidor ->
// pull -> troca 2026-11 -> 2026-10 -> 2026-11, sem fila fantasma.
const YM = '2026-11';
const CHAVE_A = '1ªSB|M1|2026-11-05';
const CHAVE_B = '1ªSB|M1|2026-11-06';

describe('Multiusuario A/B na competencia 2026-11 (mock)', () => {
  let servidor, pulls, pushes;

  beforeEach(() => {
    servidor = {}; pulls = []; pushes = [];
    const est = ym => (servidor[ym] = servidor[ym] || { versao: 1, marcas: {} });
    const lista = ym => Object.keys(est(ym).marcas).map(k => {
      const p = k.split('|');
      return { g: p[0], i: p[1], d: p[2], c: est(ym).marcas[k] };
    });

    cy.intercept('POST', '**/api/**', { statusCode: 500, body: { ok: false, erro: 'rota nao mockada' } });
    cy.intercept('POST', '**/api/login*', { statusCode: 200, body: { ok: true, token: 'token-A', perfil: 'Mestre', nome: 'Escalante A' } }).as('login');
    cy.intercept('POST', '**/api/pull*', req => {
      const ym = String(req.body.competencia).slice(0, 7);
      pulls.push({ ym, desde: req.body.desdeVersao });
      const e = est(ym);
      if (req.body.desdeVersao != null && Number(req.body.desdeVersao) === e.versao) {
        return req.reply({ ok: true, versao: e.versao, semMudanca: true });
      }
      req.reply({
        ok: true, versao: e.versao, marcas: lista(ym), comments: [], movimentos: [],
        elenco: [{ id: 'M1', secao: '1ªSB', escala: 'A', motorista: '', adm: '', restricao: '', afast: [] }],
        meta: { status: 'ativa' }
      });
    }).as('pull');
    cy.intercept('POST', '**/api/push*', req => {
      const ym = String(req.body.competencia).slice(0, 7);
      const e = est(ym);
      pushes.push({ ym, ops: req.body.ops, token: req.body.token });
      req.body.ops.forEach(op => {
        if (op.t !== 'marca') return;
        if (op.v) e.marcas[op.k] = op.v; else delete e.marcas[op.k];
      });
      e.versao += 1;
      req.reply({ ok: true, versao: e.versao });
    }).as('push');

    cy.clearLocalStorage();
    cy.visit('/index_v14.html');
    cy.get('#pinInput').type('123456');
    cy.get('#pinOk').click();
    cy.wait('@login');
    cy.wait('@pull');
    cy.get('#telaPin').should('not.exist');
  });

  const irPara = ym => {
    cy.get('#mesSel').clear().type(ym);
    cy.wrap(null).should(() => {
      expect(pulls.some(p => p.ym === ym)).to.eq(true);
    });
    cy.window().should(w => expect(String(w.eval('D.competencia')).slice(0, 7)).to.eq(ym));
  };
  const estado = (w, expr) => w.eval(expr);

  it('A marca e envia; B grava no servidor; pull aplica sem perder nada; troca de mes sem fila fantasma', () => {
    irPara(YM);

    // Usuario A marca uma celula
    cy.window().then(w => { expect(w.marcar('1ªSB', 'M1', '2026-11-05', 'X')).to.eq(true); });
    cy.wait('@push', { timeout: 10000 });
    cy.wrap(null).should(() => {
      expect(pushes.length).to.eq(1);
      expect(pushes[0].ym).to.eq(YM);
      expect(pushes[0].token).to.eq('token-A');
      expect(pushes[0].ops).to.deep.include({ t: 'marca', k: CHAVE_A, v: 'X' });
    });

    // Usuario B grava outra marca direto no servidor (versao sobe)
    cy.then(() => { est2(servidor, YM).marcas[CHAVE_B] = 'F'; est2(servidor, YM).versao += 1; });

    // Pull do A (polling forcado) traz a marca de B e mantem a propria
    cy.window().then(w => w.atualizarDoServidor(YM));
    cy.window().should(w => {
      const marks = estado(w, 'marks');
      expect(marks[CHAVE_A]).to.eq('X');
      expect(marks[CHAVE_B]).to.eq('F');
      expect(estado(w, 'Sync.fila.length')).to.eq(0);
    });

    // Troca rapida 2026-11 -> 2026-10 -> 2026-11
    irPara('2026-10');
    irPara(YM);
    cy.window().should(w => {
      const marks = estado(w, 'marks');
      expect(marks[CHAVE_A]).to.eq('X');
      expect(marks[CHAVE_B]).to.eq('F');
      expect(estado(w, 'Sync.fila.length')).to.eq(0);
    });

    // Nenhum push fantasma depois do debounce de 1500ms
    cy.wait(2500);
    cy.wrap(null).should(() => { expect(pushes.length).to.eq(1); });
  });

  function est2(s, ym) { return (s[ym] = s[ym] || { versao: 1, marcas: {} }); }
});
