import { can } from "@cf/shared";
import type { InvoiceRow, Me, RecordStateT } from "../../lib/types";

export const stateTone: Record<RecordStateT, "ink" | "brand" | "green" | "navy"> = {
  RASCUNHO: "ink",
  SUBMETIDO: "brand",
  VALIDADO: "green",
  FECHADO: "navy",
};

/** Espelha as regras da API (a API valida sempre; aqui só se escondem botões). */
export function invoiceActions(user: Me, inv: InvoiceRow) {
  const p = user.permissions;
  const validator = can(p, "billing_providers", "validate");
  const own = inv.createdById === user.id;
  const modifiable = validator || (own && inv.state === "RASCUNHO");
  const locked = inv.state === "VALIDADO" || inv.state === "FECHADO";
  return {
    edit: can(p, "billing_providers", "edit") && modifiable,
    /** Factura validada: só pagamentos, status e observação. */
    paymentsOnly: locked,
    submit: can(p, "billing_providers", "edit") && modifiable && inv.state === "RASCUNHO",
    validate: validator && inv.state === "SUBMETIDO",
    giveBack: validator && inv.state === "SUBMETIDO",
    reopen: validator && user.role === "GESTOR" && inv.state === "VALIDADO",
    remove: can(p, "billing_providers", "delete") && modifiable && !locked,
  };
}
