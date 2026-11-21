import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from unittest.mock import patch, MagicMock
from supabase_client import sb_select


class TestSbSelectFilters:
    """Testes para a construção de filtros do sb_select com operadores PostgREST."""

    @patch('supabase_client.sb_request')
    def test_filtro_eq_padrao(self, mock_sb_request):
        """Valores sem operador devem receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"coluna": "valor"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["coluna"] == "eq.valor"

    @patch('supabase_client.sb_request')
    def test_filtro_gt(self, mock_sb_request):
        """Operador 'gt.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"quando": "gt.2026-11-01T00:00:00Z"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["quando"] == "gt.2026-11-01T00:00:00Z"

    @patch('supabase_client.sb_request')
    def test_filtro_gte(self, mock_sb_request):
        """Operador 'gte.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"quando": "gte.2026-11-01T00:00:00Z"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["quando"] == "gte.2026-11-01T00:00:00Z"

    @patch('supabase_client.sb_request')
    def test_filtro_lt(self, mock_sb_request):
        """Operador 'lt.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"quando": "lt.2026-11-30T23:59:59Z"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["quando"] == "lt.2026-11-30T23:59:59Z"

    @patch('supabase_client.sb_request')
    def test_filtro_lte(self, mock_sb_request):
        """Operador 'lte.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"quando": "lte.2026-11-30T23:59:59Z"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["quando"] == "lte.2026-11-30T23:59:59Z"

    @patch('supabase_client.sb_request')
    def test_filtro_like(self, mock_sb_request):
        """Operador 'like.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"nome": "like.%Silva%"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["nome"] == "like.%Silva%"

    @patch('supabase_client.sb_request')
    def test_filtro_ilike(self, mock_sb_request):
        """Operador 'ilike.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"nome": "ilike.%silva%"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["nome"] == "ilike.%silva%"

    @patch('supabase_client.sb_request')
    def test_filtro_in(self, mock_sb_request):
        """Operador 'in.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"id": "in.(1,2,3)"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["id"] == "in.(1,2,3)"

    @patch('supabase_client.sb_request')
    def test_filtro_is(self, mock_sb_request):
        """Operador 'is.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"campo": "is.null"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["campo"] == "is.null"

    @patch('supabase_client.sb_request')
    def test_filtro_not(self, mock_sb_request):
        """Operador 'not.' não deve receber prefixo 'eq.'."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {"status": "not.in.(cancelado,excluido)"})
        
        args, kwargs = mock_sb_request.call_args
        assert kwargs["params"]["status"] == "not.in.(cancelado,excluido)"

    @patch('supabase_client.sb_request')
    def test_filtros_mistos(self, mock_sb_request):
        """Múltiplos filtros com e sem operadores."""
        mock_sb_request.return_value = []
        
        sb_select("tabela", {
            "competencia": "2026-11",
            "quando": "gt.2026-11-01T00:00:00Z",
            "tipo": "remessa"
        })
        
        args, kwargs = mock_sb_request.call_args
        params = kwargs["params"]
        assert params["competencia"] == "eq.2026-11"
        assert params["quando"] == "gt.2026-11-01T00:00:00Z"
        assert params["tipo"] == "eq.remessa"