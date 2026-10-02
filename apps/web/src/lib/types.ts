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
