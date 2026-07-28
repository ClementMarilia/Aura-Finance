export function canManageGroup(group) {
  return Boolean(group?.can_manage_members);
}

export function canDeleteGroup(group) {
  return Boolean(group?.can_delete_group);
}

export function nextGroupRole(member) {
  return member?.group_role === "admin" ? "member" : "admin";
}

export function groupRoleLabel(member) {
  if (member?.group_role === "owner") return "Proprietário";
  if (member?.group_role === "admin") return "Administrador do grupo";
  return "Membro";
}
