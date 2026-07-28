import {
  canDeleteGroup,
  canManageGroup,
  groupRoleLabel,
  nextGroupRole,
} from "./groupRoles";

test("group permissions remain local to the selected group", () => {
  expect(canManageGroup({ can_manage_members: true })).toBe(true);
  expect(canManageGroup({ can_manage_members: false, is_admin: true })).toBe(false);
  expect(canDeleteGroup({ can_delete_group: false, can_manage_members: true })).toBe(false);
});

test("owner is protected and member roles toggle between admin and member", () => {
  expect(groupRoleLabel({ group_role: "owner" })).toBe("Proprietário");
  expect(groupRoleLabel({ group_role: "admin" })).toBe("Administrador do grupo");
  expect(groupRoleLabel({ group_role: "member" })).toBe("Membro");
  expect(nextGroupRole({ group_role: "admin" })).toBe("member");
  expect(nextGroupRole({ group_role: "member" })).toBe("admin");
});
