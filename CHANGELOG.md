# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

Mudanças ainda não lançadas ficam em **[Unreleased]**. Ao publicar, renomeie
essa seção para a nova versão com a data (ex.: `## [0.3.0] - 2026-07-01`) e abra
um novo `[Unreleased]` vazio no topo.

## [Unreleased]

### Added

- **Módulo de finanças pessoais** (fases 0 a 3 do plano em
  `docs/plans/2026-09-21-financas-pessoais/`), com grupo próprio na navegação:
  - **Painel** com saldo consolidado atual e previsto, resumo do mês contra o
    anterior e as barras de alvo × realizado do casal, nos três modos de divisão
    (sem divisão, proporcional à renda e bolo comum).
  - **Transações, Gastos e Entradas** — a mesma tela com um filtro fixo de tipo:
    livro com filtros combináveis, chips do filtro aplicado, foto do comprovante
    com miniatura e ampliação, e exportação em CSV do que está na tela.
  - **Contas** (corrente, poupança, dinheiro, vale-refeição e cartão) e
    **Categorias** planas com cor, orçamento mensal e etiquetas livres.
  - **Relatórios** com totais por categoria contra o orçamento, duas roscas
    (mês e ano) nas cores das categorias, comparativo com o período anterior e
    tendência de até duas categorias em 12 meses.
  - **Fatura** de cartão com ciclo real de fechamento e vencimento, os dois
    números separados (fatura atual e total devido), limite usado e disponível,
    parcelamento com plano persistido, estorno e antecipação de parcelas.
- Backup do banco pela API `backup()` do SQLite, com botão visível no livro.
- **Contas no módulo de investimentos**: seletor no menu lateral para escolher,
  criar e renomear contas. Cada conta tem os próprios registros — operações,
  caixas e renda fixa, aportes, proventos, metas de alocação, planejamento e
  histórico. O que já existia ficou na conta "Principal", que continua
  mostrando o patrimônio com as contas do banco; o Patrimônio do módulo de
  finanças soma todas.
- **Caixa cripto** (stablecoin na corretora, em dólar) e "Reserva de
  emergência" com o nome completo no "Novo caixa".

### Changed

- O ajuste de saldo por "Saldo do banco" compara com o saldo **livre**: o
  valor digitado é o que está solto na conta, e o que está separado em
  caixinhas fica por cima, em vez de ser comido pelo ajuste.
- Migrações agora são versionadas, com transação por versão e suporte a
  reconstrução de tabela para ampliar `CHECK`.
- `apps/web` consome os tipos de `@projeto41/contracts`; `src/lib/types.ts`
  deixou de existir. O bundle continua sem `zod`.
- As rotas da API saíram de `app.ts` para plugins por recurso, sem mudança de
  comportamento.

## [0.5.0] - 2026-06-17

### Added

- Página de Alocação: gráfico de rosca da meta ao lado dos controles, redesenhado
  em tempo real conforme você ajusta a meta de cada classe.

### Changed

- Rótulos do gráfico de rosca deixam de se sobrepor: os que ficariam grudados são
  reposicionados verticalmente e mantidos dentro da área do gráfico.

## [0.4.0] - 2026-06-17

### Added

- Exportação das operações de cripto em CSV pela carteira (botão "Exportar CSV"
  e endpoint `GET /api/export/operations.csv`), com uma coluna de moeda por
  operação.

### Changed

- Botão "Exportar CSV" com tratamento discreto: plano por padrão, ganhando fundo
  e borda apenas no hover, com microinteração no ícone de download.

## [0.3.0] - 2026-06-16

### Added

- Busca de criptomoedas por símbolo ou nome (CoinGecko) ao cadastrar operações,
  associando a moeda ao identificador correto usado na cotação.

### Changed

- Cotações de cripto passam a vir da CoinGecko, substituindo o provedor anterior
  configurado por `CRYPTO_PRICE_URL`. Use `COINGECKO_API_KEY` (plano Demo,
  opcional) para elevar o limite de requisições.

## [0.2.0] - 2026-06-16

### Added

- Cadastro de operação flexível: preencha dois dos três campos
  (Quantidade × Preço = Total) e o terceiro é calculado automaticamente, com o
  campo "auto" destacado.
- Carteira cripto: alterne a moeda da operação entre USD e BRL (converte para
  USD ao salvar) e opção de descontar a taxa Binance de 0,1%.
- Seletor de data próprio (calendário no tema) no drawer de operação.

### Changed

- Steppers numéricos customizados no tema, com passo em centavos para preço e
  total.

### Fixed

- Drawer de operação fixado à borda direita da tela.

## [0.1.0] - 2026-06-09

### Added

- Versão inicial: dashboard, carteiras cripto e B3, posições manuais, aportes,
  planejamento, alocação ideal e histórico patrimonial com snapshots diários.
