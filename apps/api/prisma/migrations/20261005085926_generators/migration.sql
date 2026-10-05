-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "codigoPP" TEXT,
    "codigoLocalizacao" TEXT,
    "codigoCliente" TEXT,
    "nome" TEXT NOT NULL,
    "regiao" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "nivel" TEXT,
    "tipo" TEXT,
    "powerCube1000" BOOLEAN,
    "subtipo" TEXT,
    "distanciaFacturacao" TEXT,
    "tipoAcesso" TEXT,
    "pavimentadoInterior" BOOLEAN,
    "ligadoRede" BOOLEAN,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generator" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "numeroSerie" TEXT NOT NULL,
    "numeroActivo" TEXT,
    "potenciaKVA" INTEGER,
    "dataInstalacao" DATE,
    "dataRemocao" DATE,
    "dataEntrada" DATE,

    CONSTRAINT "Generator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorMonthlyMap" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "state" "RecordState" NOT NULL DEFAULT 'RASCUNHO',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratorMonthlyMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratorMeasurement" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "generatorId" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "horasN1" DECIMAL(12,2),
    "horasN" DECIMAL(12,2),
    "litros" DECIMAL(12,2),
    "precoCombustivelCent" BIGINT,
    "precoServAbastCent" BIGINT,
    "precoAluguerDiaCent" BIGINT,
    "precoManutencaoCent" BIGINT,
    "servExtrasCent" BIGINT,
    "penExcessoHorasCent" BIGINT,
    "penSLACent" BIGINT,
    "penNivelCombustCent" BIGINT,
    "penAvariaCent" BIGINT,
    "horasTrabalhadas" INTEGER,
    "horasRede" INTEGER,
    "descontoPercent" DECIMAL(5,2),
    "combustivelCent" BIGINT NOT NULL,
    "servAbastCent" BIGINT NOT NULL,
    "abastecimentoCent" BIGINT NOT NULL,
    "aluguerCent" BIGINT NOT NULL,
    "descontoRedeCent" BIGINT NOT NULL,
    "totalCent" BIGINT NOT NULL,
    "flags" TEXT[],
    "state" "RecordState" NOT NULL DEFAULT 'RASCUNHO',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratorMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyIndicators" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "sitesRedePublica" INTEGER,
    "sitesRedeConfiguradosNetEco" INTEGER,
    "sitesRedeSemGarantia" INTEGER,
    "poupancaCent" BIGINT,
    "transporteExtraCent" BIGINT,

    CONSTRAINT "MonthlyIndicators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_teamId_regiao_idx" ON "Site"("teamId", "regiao");

-- CreateIndex
CREATE INDEX "Site_nome_idx" ON "Site"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Site_teamId_codigoPP_key" ON "Site"("teamId", "codigoPP");

-- CreateIndex
CREATE UNIQUE INDEX "Generator_numeroSerie_key" ON "Generator"("numeroSerie");

-- CreateIndex
CREATE INDEX "Generator_siteId_idx" ON "Generator"("siteId");

-- CreateIndex
CREATE INDEX "Generator_providerId_idx" ON "Generator"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratorMonthlyMap_teamId_providerId_ano_mes_key" ON "GeneratorMonthlyMap"("teamId", "providerId", "ano", "mes");

-- CreateIndex
CREATE INDEX "GeneratorMeasurement_siteId_idx" ON "GeneratorMeasurement"("siteId");

-- CreateIndex
CREATE INDEX "GeneratorMeasurement_generatorId_idx" ON "GeneratorMeasurement"("generatorId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratorMeasurement_mapId_generatorId_key" ON "GeneratorMeasurement"("mapId", "generatorId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyIndicators_mapId_key" ON "MonthlyIndicators"("mapId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generator" ADD CONSTRAINT "Generator_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generator" ADD CONSTRAINT "Generator_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMonthlyMap" ADD CONSTRAINT "GeneratorMonthlyMap_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMonthlyMap" ADD CONSTRAINT "GeneratorMonthlyMap_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMonthlyMap" ADD CONSTRAINT "GeneratorMonthlyMap_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMeasurement" ADD CONSTRAINT "GeneratorMeasurement_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GeneratorMonthlyMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMeasurement" ADD CONSTRAINT "GeneratorMeasurement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMeasurement" ADD CONSTRAINT "GeneratorMeasurement_generatorId_fkey" FOREIGN KEY ("generatorId") REFERENCES "Generator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratorMeasurement" ADD CONSTRAINT "GeneratorMeasurement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyIndicators" ADD CONSTRAINT "MonthlyIndicators_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GeneratorMonthlyMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
