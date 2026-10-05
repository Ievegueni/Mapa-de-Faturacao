-- DropIndex
DROP INDEX "Site_teamId_codigoPP_key";

-- CreateIndex
CREATE INDEX "Site_teamId_codigoPP_idx" ON "Site"("teamId", "codigoPP");
