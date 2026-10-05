import type { BillingType, PermissionKey, Role } from "@cf/shared";

export interface TeamRef {
  id: string;
  nome: string;
  tipo: BillingType;
  ativo?: boolean;
}

export interface Me {
  id: string;
  nome: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  teams: TeamRef[];
  permissions: PermissionKey[];
  billingTypes: BillingType[];
  homePath: string;
}

export interface UserRow {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  teams: TeamRef[];
}

export interface TeamMemberRow {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
}

export interface TeamRow {
  id: string;
  nome: string;
  tipo: BillingType;
  ativo: boolean;
  members: TeamMemberRow[];
}

export interface PermissionsView {
  userId: string;
  role: Role;
  defaults: PermissionKey[];
  overrides: { module: string; action: string; allowed: boolean }[];
  effective: PermissionKey[];
}

export interface BudgetRow {
  id: string;
  providerId: string;
  teamId: string | null;
  ano: number;
  po: string | null;
  orcamentoMensalCent: string | null;
  team: TeamRef | null;
}

export interface ProviderRow {
  id: string;
  nome: string;
  nif: string | null;
  contacto: string | null;
  email: string | null;
  tipos: BillingType[];
  ativo: boolean;
  budgets: BudgetRow[];
}

export interface RentPriceRow {
  id: string;
  priceTableId: string;
  potenciaKVA: number | null;
  subtipo: string | null;
  distancia: string | null;
  precoDiaCent: string | null;
}

export interface PriceTableRow {
  id: string;
  providerId: string;
  validFrom: string;
  precoCombustivelCent: string | null;
  precoServAbastCent: string | null;
  precoManutencaoCent: string | null;
  ivaPercent: string | null;
  rentPrices: RentPriceRow[];
}

export interface DiscountRuleRow {
  id: string;
  horasMin: number;
  horasMax: number;
  percent: string;
  validFrom: string;
}

export interface TargetRow {
  id: string;
  ano: number;
  mes: number;
  providerId: string | null;
  aluguerCent: string | null;
  combustivelCent: string | null;
}

export type InvoiceStatusT = "ABERTO" | "ANDAMENTO" | "PENDENTE" | "FECHADO";
export type RecordStateT = "RASCUNHO" | "SUBMETIDO" | "VALIDADO" | "FECHADO";

export interface InvoiceRow {
  id: string;
  teamId: string;
  providerId: string;
  ano: number;
  mes: number;
  po: string | null;
  tipo: string;
  numeroFactura: string | null;
  dataFacturacao: string | null;
  dataExecucao: string | null;
  qtdOTs: number | null;
  consumiveis: number | null;
  valorFTCent: string;
  valorPagoCent: string;
  dividaCent: string;
  status: InvoiceStatusT;
  observacao: string | null;
  state: RecordStateT;
  createdById: string;
  team: { id: string; nome: string };
  provider: { id: string; nome: string };
  createdBy: { id: string; nome: string };
  validatedBy: { id: string; nome: string } | null;
  validatedAt: string | null;
}

export interface InvoiceList {
  items: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { valorFTCent: string; valorPagoCent: string; dividaCent: string };
}

export interface BillingOptions {
  teams: { id: string; nome: string }[];
  providers: { id: string; nome: string }[];
}

export interface ProviderSummaryRow {
  providerId: string;
  nome: string;
  facturadoMes: string[];
  pagoMes: string[];
  orcamentoMensal: string | null;
  orcamentoAnual: string | null;
  facturadoAno: string;
  pagoAno: string;
  divida: string;
  remanescente: string | null;
  execucaoPercent: number | null;
  mesesAcimaOrcamento: number[];
}

export interface ProvidersSummary {
  ano: number;
  teamId: string | null;
  providers: ProviderSummaryRow[];
  totalMes: string[];
  totalAno: string;
  pagoAno: string;
  dividaAno: string;
}

export interface GeneratorOptions {
  teams: { id: string; nome: string }[];
  providers: { id: string; nome: string }[];
  provincias: string[];
  potencias: number[];
}

export interface SiteRow {
  id: string;
  teamId: string;
  nome: string;
  codigoPP: string | null;
  codigoLocalizacao: string | null;
  codigoCliente: string | null;
  regiao: string;
  provincia: string;
  nivel: string | null;
  tipo: string | null;
  powerCube1000: boolean | null;
  subtipo: string | null;
  distanciaFacturacao: string | null;
  tipoAcesso: string | null;
  pavimentadoInterior: boolean | null;
  ligadoRede: boolean | null;
  team: { id: string; nome: string };
  generators: { id: string; numeroSerie: string; potenciaKVA: number | null; dataRemocao: string | null; provider: { id: string; nome: string } }[];
  _count: { measurements: number };
}

export interface GeneratorRow {
  id: string;
  siteId: string;
  providerId: string;
  numeroSerie: string;
  numeroActivo: string | null;
  potenciaKVA: number | null;
  dataInstalacao: string | null;
  dataRemocao: string | null;
  dataEntrada: string | null;
  provider: { id: string; nome: string };
  site: { id: string; nome: string; codigoPP: string | null; teamId: string; provincia: string; regiao: string };
  _count: { measurements: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MapStats {
  medicoes: number;
  totalCent: string;
  aluguerCent: string;
  combustivelCent: string;
  servAbastCent: string;
  descontoRedeCent: string;
  litros: string;
  porEstado: Record<string, number>;
  flags: Record<string, number>;
}

export interface GeneratorMapRow {
  id: string;
  teamId: string;
  providerId: string;
  ano: number;
  mes: number;
  state: RecordStateT;
  closedAt: string | null;
  team: { id: string; nome: string };
  provider: { id: string; nome: string };
  closedBy: { id: string; nome: string } | null;
  stats: MapStats;
}

export interface GeneratorMapDetail extends GeneratorMapRow {
  priceTable: (Omit<PriceTableRow, "validFrom"> & { validFrom: string }) | null;
  bands: { horasMin: number; horasMax: number; percent: string; validFrom: string }[];
}

export interface MeasurementRow {
  id: string;
  mapId: string;
  siteId: string;
  generatorId: string;
  dias: number;
  horasN1: string | null;
  horasN: string | null;
  litros: string | null;
  precoCombustivelCent: string | null;
  precoServAbastCent: string | null;
  precoAluguerDiaCent: string | null;
  precoManutencaoCent: string | null;
  servExtrasCent: string | null;
  penExcessoHorasCent: string | null;
  penSLACent: string | null;
  penNivelCombustCent: string | null;
  penAvariaCent: string | null;
  horasTrabalhadas: number | null;
  horasRede: number | null;
  descontoPercent: string | null;
  combustivelCent: string;
  servAbastCent: string;
  abastecimentoCent: string;
  aluguerCent: string;
  descontoRedeCent: string;
  totalCent: string;
  flags: string[];
  state: RecordStateT;
  createdById: string;
  site: { id: string; nome: string; codigoPP: string | null; regiao: string; provincia: string; subtipo: string | null; distanciaFacturacao: string | null };
  generator: { id: string; numeroSerie: string; potenciaKVA: number | null; dataRemocao: string | null };
  createdBy: { id: string; nome: string };
}

export interface MeasurementList extends Paged<MeasurementRow> {
  totals: { litros: string; combustivelCent: string; servAbastCent: string; aluguerCent: string; descontoRedeCent: string; totalCent: string };
}

export interface MapGeneratorItem {
  id: string;
  numeroSerie: string;
  potenciaKVA: number | null;
  site: { id: string; nome: string; codigoPP: string | null; provincia: string };
  measurement: { id: string; state: RecordStateT; flags: string[]; totalCent: string } | null;
}

export interface GeneratorFormContext {
  generator: { id: string; numeroSerie: string; potenciaKVA: number | null; dataRemocao: string | null };
  site: SiteRow;
  measurement: MeasurementRow | null;
  horasNMesAnterior: string | null;
  mediaLitros3m: string | null;
}

export interface ImportPreview {
  token: string;
  expiraEm: string;
  ficheiro: string;
  folhas: string[];
  folha: string;
  linhaCabecalho: number;
  linhasLidas: number;
  semPrecos: boolean;
  linhasValidas: number;
  sitesNovos: number;
  sitesActualizados: number;
  geradoresNovos: number;
  geradoresActualizados: number;
  medicoesNovas: number;
  medicoesActualizadas: number;
  litrosFicheiro: string;
  litrosValidos: string;
  totais: { combustivelCent: string; servAbastCent: string; aluguerCent: string; descontoRedeCent: string; totalCent: string };
  flags: Record<string, number>;
  erros: { line: number; message: string }[];
  avisos: { line: number; message: string }[];
  amostra: { linha: number; site: string; codigoPP: string | null; numeroSerie: string; novo: boolean; dias: number; litros: string | null; horasRede: number | null; descontoPercent: string | null; totalCent: string; flags: string[] }[];
}
