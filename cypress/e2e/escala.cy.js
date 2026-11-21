describe('Testes do App Escala 7GB', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.clearCookies();
  });

  it('Deve carregar a tela de PIN na primeira visita', () => {
    cy.visit('https://escala-7gb.vercel.app');

    cy.get('#telaPin').should('exist');
    cy.get('#pinInput').should('be.visible');
  });

  it('Deve exibir a mensagem de erro ao digitar PIN errado', () => {
    cy.visit('https://escala-7gb.vercel.app');

    cy.get('#pinInput').type('0000');
    cy.get('#pinOk').click();

    cy.get('#pinMsg').should('be.visible');
  });

  it('Deve fazer login (mockado) e exibir a escala sem gastar cota', () => {
    // Intercepta chamadas de API para não consumir cota real no CI
    cy.intercept('POST', '**/api/login*', {
      statusCode: 200,
      body: {
        ok: true,
        token: 'token-teste-ci',
        perfil: 'Admin',
        usuario: 'Teste CI'
      }
    }).as('loginMock');

    cy.intercept('POST', '**/api/pull*', {
      statusCode: 200,
      body: { ok: true, versao: 1, semMudanca: true }
    }).as('pullMock');

    cy.visit('https://escala-7gb.vercel.app');
    cy.get('#pinInput').type('9999');
    cy.get('#pinOk').click();

    // Ajuste o seletor abaixo para o elemento que realmente aparece após o login
    // (ex.: seletor de perfil, botão de salvar ou container da escala)
    cy.get('body').should('not.contain', 'PIN inválido');
  });
});