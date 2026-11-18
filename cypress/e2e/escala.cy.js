describe('Testes do App Escala 7GB', () => {
  
  it('Deve carregar a tela de PIN na primeira visita', () => {
    // Limpa o localStorage para simular um usuário novo
    cy.clearLocalStorage();
    cy.visit('https://escala-7gb.vercel.app');
    
    // Verifica se a tela de PIN apareceu
    cy.get('#botaoQueNaoExiste').should('exist');
    cy.get('#pinInput').should('be.visible');
  });

  it('Deve exibir a mensagem de erro ao digitar PIN errado', () => {
    cy.visit('https://escala-7gb.vercel.app');
    
    // Digita um PIN inválido e clica em Entrar
    cy.get('#pinInput').type('000000');
    cy.get('#pinOk').click();
    
    // Espera a mensagem de erro aparecer na tela
    cy.get('#pinMsg').should('contain', 'PIN inválido');
  });

  // NOTA: Para testar o login com sucesso, você precisará substituir '123456'
  // pelo PIN real de um usuário de teste no seu banco.
  
  it('Deve fazer login e exibir a escala', () => {
    cy.visit('https://escala-7gb.vercel.app');
    cy.get('#pinInput').type('123456'); // Troque pelo PIN real
    cy.get('#pinOk').click();
    
    // Espera o menu carregar (indicando que o login funcionou)
    cy.get('nav button').should('have.length.at.least', 1);
  });
  
});