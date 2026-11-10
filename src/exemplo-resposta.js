// Resposta de exemplo da documentação (seção 06), usada no modo KSI_MODO=simulado.
// Dados fictícios.
import crypto from 'node:crypto';

export function gerarRespostaSimulada(tipoPessoa, documento) {
  const r = structuredClone(EXEMPLO);
  r.logQuery = crypto.randomUUID();
  r.relatorioRatingBancario.logQuery = `logQuery_${crypto.randomBytes(6).toString('hex')}`;
  const rel = r.relatorioRatingBancario.relatorioRatingBancario;
  if (tipoPessoa === '0') {
    rel.cadastraispf.documento = 'CPF ' + documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  } else {
    rel.cadastraispj.documento = documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return r;
}

const EXEMPLO = {
  baseDisponivel: true,
  logQuery: '32d0e39c-6c70-4318-ad10-c1e26e227851',
  relatorioRatingBancario: {
    relatorioRatingBancario: {
      classificacaoRisco: 'BAIXO',
      comprometimentoRenda: '28%',
      relatorioIA: {
        analiseAiConsultado: true,
        aprovado: true,
        analiseAi: 'Cliente com bom perfil financeiro, baixa inadimplência e renda estável.',
      },
      recuperacaoFalencia: 'SEM_OCORRENCIAS',
      cadastraispf: {
        nomeDaMae: 'Maria de Lourdes Alves',
        situacaoCpf: 'REGULAR',
        rg: '42.556.893-2',
        clientePremium: 'SIM',
        classeSocial: 'B2',
        qntPessoasContatos: 1,
        pessoasContatos: [{ nome: 'João Henrique Souza', documento: 'CPF 123.456.789-10', descricaos: 'Contato de emergência' }],
        qntParticipacaoSocietaria: 1,
        participacoesSocietaria: [
          { cnpj: '12.345.678/0001-90', razaoSocial: 'Alfa Serviços Digitais LTDA', posicao: 'Sócio Administrador', situacao: 'ATIVA' },
        ],
        faixa: '35-45_ANOS',
        nome: 'Carlos Eduardo Pereira',
        documento: 'CPF 987.654.321-00',
        dataNascimento: '1987-09-15',
        qntEmails: 1,
        emails: ['carlos.pereira@email.com'],
        qntTelefones: 1,
        telefones: ['(11) 98888-1234'],
        qntEnderecos: 1,
        enderecos: [
          { cep: '04567-020', uf: 'SP', cidade: 'São Paulo', bairro: 'Itaim Bibi', logradouro: 'Rua Joaquim Floriano', numero: '1450', complemento: 'Apto 72' },
        ],
        score: 820,
        pontualidadeDePagamento: 0.98,
        limiteDeCredito: 45000,
        rendaEstimada: 18500,
      },
      cadastraispj: {
        atividadePrincipal: 'Desenvolvimento de software sob encomenda',
        porte: 'PEQUENA',
        situacao: 'ATIVA',
        faturamentoPresumido: 750000,
        capitalSocial: 150000,
        qntQuadroSociatario: 1,
        quadroSociatario: [{ nome: 'Carlos Eduardo Pereira', documento: 'CPF 987.654.321-00', descricaos: 'Sócio administrador' }],
        nome: 'Alfa Serviços Digitais LTDA',
        documento: '12.345.678/0001-90',
        dataNascimento: '2018-05-12',
        qntEmails: 1,
        emails: ['contato@alfaservicos.com'],
        qntTelefones: 1,
        telefones: ['(11) 4002-8922'],
        qntEnderecos: 1,
        enderecos: [
          { cep: '04567-020', uf: 'SP', cidade: 'São Paulo', bairro: 'Itaim Bibi', logradouro: 'Av. Pres. Juscelino Kubitschek', numero: '2041', complemento: 'Conj. 101' },
        ],
        score: 780,
        pontualidadeDePagamento: 0.95,
        limiteDeCredito: 120000,
        rendaEstimada: 750000,
      },
      quantidadeSerasa: 1,
      registrosSerasa: [{ data: '2023-11-10', contrato: 'CTR-55421', informante: 'Banco XPTO', valor: 650 }],
      quantidadeSPC: 1,
      registrosSPC: [{ data: '2023-07-02', contrato: 'SPC-99234', informante: 'Lojas Brasil', valor: 320 }],
      quantidadeChSemFundos: 1,
      registrosChSemFundos: [{ nBanco: '341', nomeBanco: 'Itaú Unibanco', agencia: '1234', quantidade: 2 }],
      quantidadeBoaVista: 1,
      registrosBoaVista: [{ data: '2022-10-08', contrato: 'BV-778899', informante: 'Financeira Nível A', valor: 1200 }],
      registroScr: {
        databaseConsultada: 'SCR - 2024-12',
        dataInicioRelacionamento: '2015-03-22',
        quantidadeInstituicoes: 3,
        quantidadeOperacoes: 12,
        quantidadeOperacoesDiscordancia: 0,
        quantidadeOperacoesSubjudice: 0,
        score: { pontuacao: '760', faixa: 'ALTA' },
        score1: { pontuacao: '782', faixa: 'EXCELENTE' },
        carteiraCredito: { creditoAvencer: '120000.00', creditoVencido: '0.00', prejuizo: '0.00', limiteCredito: '150000.00' },
        operacoes: [
          {
            modalidade: { codigo: '01', descricao: 'Empréstimo Pessoal' },
            subModalidade: { codigo: '01A', descricao: 'Crédito Consignado' },
            variacaoCambial: 'N/A',
            total: '35000.00',
            total1: 35000,
            percentual: '23%',
            vencimentos: [{ codigo: 'V1', descricao: 'A vencer', valor: '35000.00', valor1: 35000, percentual: '100%', restritivo: 'NAO' }],
          },
        ],
        operacoes1: [
          {
            modalidade: { codigo: '02', descricao: 'Cartão de Crédito' },
            subModalidade: { codigo: '02B', descricao: 'Rotativo' },
            variacaoCambial: 'N/A',
            total: '5000.00',
            percentual: '7%',
            vencimentos: [{ codigo: 'V2', descricao: 'A vencer', valor: '5000.00', percentual: '100%', restritivo: 'NAO', qtdMeses: '1' }],
          },
        ],
      },
      contemProtesto: true,
      qntProtesto: 1,
      valorTotalProtesto: 980,
      registrosProtesto: [
        { cartorio: 'Cartório 12º Tabelião', endereco: 'Rua da Consolação, 2500', municipio: 'São Paulo', data: '2022-04-12', valor: 980 },
      ],
      informacoesAdicionais: {
        informacoesAlertasRestricoes: {
          statusRetorno: { codigo: '206', descricao: 'Ocorrências encontradas' },
          quantidadeOcorrencia: '1',
          ocorrencias: [
            {
              codigoTipoInformacao: '010',
              descricaoTipoInformacao: 'Atraso recente',
              titulo: 'Pagamento em atraso',
              observacoes: 'Atraso regularizado em outubro de 2023',
            },
          ],
        },
        passagensComerciais: {
          statusRetorno: { codigo: '200', descricao: 'Consulta concluída' },
          quantidadeOcorrencia: '2',
          ocorrencias: [
            { dataConsulta: '2024-10-14', horaConsulta: '14:22', clienteConsulta: 'Magazine Max', telefoneCliente: '(11) 3322-4455', cidadeUfCliente: 'São Paulo/SP' },
            { dataConsulta: '2024-11-02', horaConsulta: '10:50', clienteConsulta: 'Mercado Rápido', telefoneCliente: '(11) 99000-1111', cidadeUfCliente: 'São Paulo/SP' },
          ],
        },
        acoesCiveis: {
          quantidadeOcorrencia: '1',
          ocorrencias: [
            {
              requerido: 'Carlos Eduardo Pereira',
              valor: '3200.00',
              acao: 'Cobrança',
              documento: 'CPF 987.654.321-00',
              foro: 'SP',
              origem: 'TJ-SP',
              vara: '12ª Vara Cível',
              comarca: 'São Paulo',
              autor: 'Empresa Delta Ltda',
              processo: '1023345-88.2022.8.26.0100',
              dataDistribuicao: '2022-08-05',
            },
          ],
        },
      },
      contemRestricoesSinteticas: true,
      qntRestricoesSinteticas: 1,
      valorTotalRestricoesSinteticas: 450,
      endividamentoFinanceiro: 'BAIXO',
      creditoEmergencial: 'NÃO UTILIZADO',
      relacionamentoMercado: 'OTIMO',
      indiceRisco: 0.12,
      risco: 'BAIXO',
      indiceFinanceiro: 0.85,
      classificacaoFinanceira: 'A',
      capacidadePagemento: 0.91,
    },
    baseDisponivel: true,
    logQuery: 'logQuery_888da0601aad',
  },
};
