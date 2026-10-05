-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nif" TEXT,
    "contacto" TEXT,
    "email" TEXT,
    "tipos" "BillingType"[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderBudget" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "teamId" TEXT,
    "ano" INTEGER NOT NULL,
    "po" TEXT,
    "orcamentoMensalCent" BIGINT,

    CONSTRAINT "ProviderBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTable" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "precoCombustivelCent" BIGINT,
    "precoServAbastCent" BIGINT,
    "precoManutencaoCent" BIGINT,
    "ivaPercent" DECIMAL(5,2),

    CONSTRAINT "PriceTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentPrice" (
    "id" TEXT NOT NULL,
    "priceTableId" TEXT NOT NULL,
    "potenciaKVA" INTEGER,
    "subtipo" TEXT,
    "distancia" TEXT,
    "precoDiaCent" BIGINT,

    CONSTRAINT "RentPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GridDiscountRule" (
    "id" TEXT NOT NULL,
    "horasMin" INTEGER NOT NULL,
    "horasMax" INTEGER NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "validFrom" DATE NOT NULL,

    CONSTRAINT "GridDiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "providerId" TEXT,
    "aluguerCent" BIGINT,
    "combustivelCent" BIGINT,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_nome_key" ON "Provider"("nome");

-- CreateIndex
CREATE INDEX "ProviderBudget_ano_idx" ON "ProviderBudget"("ano");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBudget_providerId_teamId_ano_key" ON "ProviderBudget"("providerId", "teamId", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTable_providerId_validFrom_key" ON "PriceTable"("providerId", "validFrom");

-- CreateIndex
CREATE INDEX "RentPrice_priceTableId_idx" ON "RentPrice"("priceTableId");

-- CreateIndex
CREATE INDEX "GridDiscountRule_validFrom_idx" ON "GridDiscountRule"("validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Target_ano_mes_providerId_key" ON "Target"("ano", "mes", "providerId");

-- AddForeignKey
ALTER TABLE "ProviderBudget" ADD CONSTRAINT "ProviderBudget_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderBudget" ADD CONSTRAINT "ProviderBudget_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTable" ADD CONSTRAINT "PriceTable_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentPrice" ADD CONSTRAINT "RentPrice_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "PriceTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Linhas com equipa/provider vazio: o índice único normal trata NULL como distinto.
CREATE UNIQUE INDEX "ProviderBudget_default_unique" ON "ProviderBudget"("providerId", "ano") WHERE "teamId" IS NULL;
CREATE UNIQUE INDEX "Target_global_unique" ON "Target"("ano", "mes") WHERE "providerId" IS NULL;
