// E2E 100% mockado (cy.intercept): nenhum request chega a producao,
// portanto LOGIN_TENTATIVAS real nunca e incrementado.
describe('Escala 7GB - tela de PIN (offline)', () => {
  beforeEach(() => {
    cy.intercept('POST', '**/api/**', { statusCode: 500, body: { ok: false, erro: 'rota nao mockada' } }).as('naoMockada');
    cy.clearLocalStorage();
    cy.clearCookies();
  });

  it('carrega a tela de PIN na primeira visita', () => {
    cy.visit('/index_v14.html');
    cy.get('#telaPin').should('exist');
    cy.get('#pinInput').should('be.visible');
  });

  it('exibe erro com PIN invalido (login mockado 401)', () => {
    cy.intercept('POST', '**/api/login*', { statusCode: 401, body: { ok: false, erro: 'PIN inválido', tentativas: 1 } }).as('login');
    cy.visit('/index_v14.html');
    cy.get('#pinInput').type('000000');
    cy.get('#pinOk').click();
    cy.wait('@login');
    cy.get('#pinMsg').should('contain', 'PIN inválido');
    cy.get('#telaPin').should('exist');
  });

  it('faz login mockado e fecha a tela de PIN', () => {
    cy.intercept('POST', '**/api/login*', { statusCode: 200, body: { ok: true, token: 'token-teste-ci', perfil: 'Mestre', nome: 'Teste CI' } }).as('login');
    cy.intercept('POST', '**/api/pull*', { statusCode: 200, body: { ok: true, versao: 1, marcas: [], comments: [], elenco: [], meta: { status: 'ativa' } } }).as('pull');
    cy.visit('/index_v14.html');
    cy.get('#pinInput').type('999999');
    cy.get('#pinOk').click();
    cy.wait('@login');
    cy.wait('@pull');
    cy.get('#telaPin').should('not.exist');
  });
});
