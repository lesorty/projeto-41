# Handoff — módulo de finanças pessoais

> Estado da implementação do plano em `00-plano-mestre.md`. Atualize este
> arquivo ao concluir cada fase.

- **Branch:** `feat/financas-pessoais`
- **Última atualização:** 2026-09-22
- **Fases concluídas:** 0, 1, 2, 3, 4 e 5
- **Fases pendentes:** 6 (importação OFX/CSV), 7 (recorrentes), 8 (PDF)

## Como verificar o que existe

```bash
npm test
```

```bash
npm run typecheck && npm run lint && npm run build
```

461 testes passam. A **única** falha conhecida de `npm test` é
`scripts/launch-project.test.mjs`, que **já falhava antes** deste trabalho: ele
compara o separador de `PATH` com `:` fixo e quebra no Windows, que usa `;`.
Não tem relação com o módulo de finanças.

Para rodar o app: `npm run dev`, e abra o grupo **Finanças** na navegação.

## O que está pronto

### Fase 0 — fundação
- Runner de migrações versionadas em `packages/db/src/migrations/runner.ts`, com
  transação por versão, validação de sequência e `rebuildTable` para ampliar
  `CHECK`. `foreign_keys` fica desligado durante a execução porque o contador de
  FK adiado não zera ao recriar a tabela.
- Helpers monetários em centavos (`packages/finance/src/money.ts`).
- Rotas da API divididas em plugins por recurso; `app.ts` só orquestra.
- `apps/web` consome `@projeto41/contracts`; `lib/types.ts` não existe mais e o
  bundle continua sem `zod`.

### Fase 1 — núcleo do livro-caixa
Pessoas, contas, categorias, etiquetas, locais, lançamentos, transferências,
filtros, fotos de comprovante (WebP + miniatura, endereçado por sha256) e
backup do SQLite. Telas: Transações, Gastos, Entradas, Contas, Categorias.

### Fase 2 — dashboard, relatórios e alvos
Orçamento por categoria, divisão-alvo nos três modos, comparativo entre períodos
com recorte justo de mês parcial, duas roscas e tendência. Telas: Painel e
Relatórios.

### Fase 3 — cartão, fatura e parcelamento
Ciclo real de fatura (teste de propriedade sobre 3 anos × 121 combinações de
fechamento/vencimento), os dois números de 6.1 sempre separados, parcelamento
com plano persistido, estorno, antecipação reversível e o `SeriesScopeDialog`
genérico que a fase 7 vai herdar. Tela: Fatura.

### Fase 4 — investimentos e patrimônio
Operação de investimento debita a conta escolhida; patrimônio unificado com
classes `ledger:*`, passivo de cartão e aviso de contagem dupla; snapshot
versionado com degrau no histórico. Tela: Patrimônio.

### Fase 5 — caixinhas e CDI
Motor de CDI puro (o exemplo trabalhado do plano fecha exato), IOF e IR
regressivos lote a lote, calendário de feriados 1999–2099 e semente real da
série 12 do SGS com 2.189 linhas. Tela: Caixinhas.

## Decisões tomadas durante a implementação

Estas não estavam nos documentos e valem para quem continuar.

1. **Conflito entre fases sobre saque de caixinha.** A fase 5 diz que sacar
   deveria devolver folga ao alvo do mês; a fase 3 diz que não. O plano mestre
   6.4 fecha com "não conta: nenhuma outra transferência" e vence por regra
   própria. O saque **não** abate o realizado, e há teste documentando a
   escolha em `packages/db/src/repositories/goals.test.ts`.

2. **Calendário ANBIMA gerado, não baixado.** O arquivo oficial é `.xls`
   binário e exigiria um parser que serviria uma vez só. `scripts/build-reference-data.mjs`
   gera a lista das regras legais que a própria ANBIMA aplica, e
   `reference-data.test.ts` confere as datas de amostra. Se a lista divergir,
   corrija o script e regenere.

3. **`countsTowardTarget` perdeu o `.default(true)` do contrato.** Ausente
   significa "derive pela regra 6.4"; presente é a exceção manual. Um padrão
   apagaria a diferença entre "o usuário não disse" e "o usuário marcou".

4. **Os repositórios recebem os tipos `*Draft`** (input dos schemas, antes dos
   defaults), porque cada um já aplica o próprio padrão ao gravar.

5. **O design importado do Claude Design não foi aplicado.** Veja a seção
   "Pendências" abaixo.

## Bugs reais encontrados e corrigidos no caminho

- `balances.ts` calculava a "fatura atual" pelo mês-calendário enquanto
  `cards.ts` usava o ciclo do cartão: a mesma fatura aparecia como R$ 535 numa
  tela e R$ 300 na outra. Agora existe uma definição só, com teste afirmando
  que as duas camadas concordam.
- O gerador de feriados duplicava 21/04 em 2000 e 2079, quando a Sexta-feira
  Santa cai em Tiradentes.
- Uma falha de rede passageira no serviço do CDI bloqueava qualquer nova
  tentativa por 15 minutos. O teto passou a valer para o último contato
  bem-sucedido.
- `installments()` devolvia a série na ordem do livro (`date DESC`): ninguém lê
  "3/3, 2/3, 1/3".

## Pendências

### 1. O design do Claude Design não foi importado

A tarefa pedia implementar a partir de
`https://claude.ai/design/p/2f7d8e0b-40de-49ec-9ef7-c22b303971d6`
(`Finanças - Telas.dc.html`). **Não foi possível ler esse projeto**: a
ferramenta `DesignSync` exige uma autorização que só pode ser concedida rodando
`/design-login` uma vez num terminal interativo, e esta sessão não é
interativa.

As telas foram construídas sobre o design system que já existe no app —
`Card`/`Panel`/`Drawer`/`Modal`/`data-table`, os tokens de `:root` e a paleta do
tema —, que é exatamente o que os documentos de fase especificam em detalhe
("usar exclusivamente os tokens existentes", "seguir o padrão de `ui.tsx`",
"nenhuma cor literal"). Por isso a diferença entre o que existe e o design
importado deve ser de **aparência, não de estrutura**: as telas, os campos e os
fluxos seguem a especificação escrita.

**Para aplicar o design:**

```bash
claude
```

Rode `/design-login` uma vez nesse terminal. Depois, numa sessão nova, peça a
importação: as classes novas têm todas o prefixo `fin-` e vivem no fim de
`apps/web/src/styles/index.css`, então o restyling fica contido.

### 2. Fases 6, 7 e 8

Não iniciadas. Os documentos de fase estão completos e as fundações que elas
pedem já existem:

- **Fase 6 (OFX/CSV):** `entries.external_id` e o índice único parcial
  `UNIQUE(account_id, external_id)` já existem desde a fase 1;
  `entries.import_row_id` está declarado como INTEGER solto, à espera do
  `rebuildTable` que lhe dará a FK quando `import_rows` existir. `raw_description`
  também já existe.
- **Fase 7 (recorrentes):** o `SeriesScopeDialog` já é genérico e testado, e o
  contrato `seriesScopeSchema` já mora em `packages/contracts/src/cards.ts`
  justamente para ser reaproveitado.
- **Fase 8 (PDF):** depende da 6. O valor `'needs_review'` já está previsto no
  `CHECK` que a fase 6 vai criar.

### 3. Dados de demonstração no banco local

A verificação no app rodando criou dados reais em `data/projeto41.sqlite`:
contas, categorias com lançamentos, um cartão com parcelamento e uma caixinha
rendendo CDI. Se quiser começar limpo, apague `data/projeto41.sqlite` — ele é
recriado vazio na próxima execução (a pasta `data/` não é versionada).

### 4. Teste do launcher quebrado no Windows

`scripts/launch-project.test.mjs` compara o separador de `PATH` com `:` fixo.
Pré-existente, sem relação com este trabalho, e já sugerido como tarefa
separada.
