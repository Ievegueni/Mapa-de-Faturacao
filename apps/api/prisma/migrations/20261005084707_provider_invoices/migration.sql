-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ABERTO', 'ANDAMENTO', 'PENDENTE', 'FECHADO');

-- CreateEnum
CREATE TYPE "RecordState" AS ENUM ('RASCUNHO', 'SUBMETIDO', 'VALIDADO', 'FECHADO');

-- CreateTable
CREATE TABLE "ProviderInvoice" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "po" TEXT,
    "tipo" TEXT NOT NULL,
    "numeroFactura" TEXT,
    "dataFacturacao" DATE,
    "dataExecucao" DATE,
    "qtdOTs" INTEGER,
    "consumiveis" INTEGER,
    "valorFTCent" BIGINT NOT NULL,
    "valorPagoCent" BIGINT NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ABERTO',
    "observacao" TEXT,
    "state" "RecordState" NOT NULL DEFAULT 'RASCUNHO',
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderInvoice_teamId_ano_mes_idx" ON "ProviderInvoice"("teamId", "ano", "mes");

-- CreateIndex
CREATE INDEX "ProviderInvoice_providerId_ano_idx" ON "ProviderInvoice"("providerId", "ano");

-- CreateIndex
CREATE INDEX "ProviderInvoice_createdById_state_idx" ON "ProviderInvoice"("createdById", "state");

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
