/**
 * Safe, additive recovery for accounts left without default categories after
 * resetting their financial data. Uses existing authenticated API endpoints,
 * so it works even while the backend deployment is still behind the frontend.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Moradia", icon: "home", color: "#1E3F33", kind: "expense" },
  { name: "Mercado", icon: "shopping-cart", color: "#D96C5B", kind: "expense" },
  { name: "Transporte", icon: "car", color: "#E5A83B", kind: "expense" },
  { name: "Saúde", icon: "heart-pulse", color: "#D9453B", kind: "expense" },
  { name: "Educação", icon: "graduation-cap", color: "#3B82F6", kind: "expense" },
  { name: "Lazer", icon: "gamepad-2", color: "#7EA193", kind: "expense" },
  { name: "Assinaturas", icon: "repeat", color: "#C7BCA1", kind: "expense" },
  { name: "Contas fixas", icon: "file-text", color: "#2C5C4A", kind: "expense" },
  { name: "Compras", icon: "shopping-bag", color: "#D96C5B", kind: "expense" },
  { name: "Viagem", icon: "plane", color: "#E5A83B", kind: "expense" },
  { name: "Outros", icon: "more-horizontal", color: "#6B7068", kind: "expense" },
];

export function normalizedCategoryName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export async function restoreInitialFinanceDefaults({ api, postCreate, currency = "EUR" }) {
  const readCategories = async () => (await api.get("/categories")).data;
  const readAccounts = async () => (await api.get("/accounts")).data;

  // Fetch again right before making changes: the settings page could be stale.
  let categories = await readCategories();
  const names = new Set(categories.map((category) => normalizedCategoryName(category.name)));
  let createdCategories = 0;

  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    const key = normalizedCategoryName(category.name);
    if (names.has(key)) continue;
    try {
      await postCreate("/categories", category);
      createdCategories += 1;
      names.add(key);
    } catch (error) {
      if (error?.response?.status !== 409) throw error;
      // Another tab or a newly deployed backend may have seeded the category
      // concurrently. Treat 409 as success only when it actually exists.
      categories = await readCategories();
      if (!categories.some((item) => normalizedCategoryName(item.name) === key)) {
        throw error;
      }
      names.add(key);
    }
  }

  // The default wallet is only created if no ACTIVE wallet is accessible.
  // Archived wallets and existing financial entries are never modified.
  const accounts = await readAccounts();
  let createdAccount = false;
  if (accounts.length === 0) {
    await postCreate("/accounts", {
      name: "Conta Principal",
      type: "checking",
      initial_balance: 0,
      currency,
    });
    createdAccount = true;
  }

  const [updatedCategories, updatedAccounts] = await Promise.all([
    readCategories(),
    readAccounts(),
  ]);
  return {
    categories: updatedCategories,
    accounts: updatedAccounts,
    createdCategories,
    createdAccount,
  };
}
