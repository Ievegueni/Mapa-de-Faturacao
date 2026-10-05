-- Parceiros separados por módulo: cada Provider passa a ter um só tipo.
-- Um parceiro com os dois tipos é dividido: o registo original fica na Rede Residencial (PROVIDERS:
-- facturas e orçamentos) e é criada uma cópia para Combustível e Geradores, para onde passam
-- geradores, mapas, tabelas de preços e targets.

ALTER TABLE "Provider" ADD COLUMN "tipo" "BillingType";
DROP INDEX "Provider_nome_key";

-- Só um tipo (ou nenhum: assume Rede Residencial)
UPDATE "Provider" SET "tipo" = CASE WHEN 'PROVIDERS' = ANY("tipos") OR cardinality("tipos") = 0 THEN 'PROVIDERS'::"BillingType" ELSE 'GERADORES'::"BillingType" END;

-- Cópias para Geradores dos parceiros com os dois tipos
CREATE TEMP TABLE provider_split AS
SELECT "id" AS old_id, 'c' || substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 24) AS new_id
FROM "Provider" WHERE 'PROVIDERS' = ANY("tipos") AND 'GERADORES' = ANY("tipos");

INSERT INTO "Provider" ("id", "nome", "tipo", "nif", "contacto", "email", "tipos", "ativo")
SELECT s.new_id, p."nome", 'GERADORES', p."nif", p."contacto", p."email", ARRAY[]::"BillingType"[], p."ativo"
FROM "Provider" p JOIN provider_split s ON s.old_id = p."id";

UPDATE "Generator" g SET "providerId" = s.new_id FROM provider_split s WHERE g."providerId" = s.old_id;
UPDATE "GeneratorMonthlyMap" m SET "providerId" = s.new_id FROM provider_split s WHERE m."providerId" = s.old_id;
UPDATE "PriceTable" t SET "providerId" = s.new_id FROM provider_split s WHERE t."providerId" = s.old_id;
UPDATE "Target" t SET "providerId" = s.new_id FROM provider_split s WHERE t."providerId" = s.old_id;

DROP TABLE provider_split;

ALTER TABLE "Provider" ALTER COLUMN "tipo" SET NOT NULL;
ALTER TABLE "Provider" DROP COLUMN "tipos";
CREATE UNIQUE INDEX "Provider_nome_tipo_key" ON "Provider"("nome", "tipo");
