import {
  DEFAULT_EXPENSE_CATEGORIES,
  restoreInitialFinanceDefaults,
} from "./restoreFinanceDefaults";

function mockedBackend({
  categories = [],
  accounts = [],
  failOnCategory = null,
  conflictingName = null,
} = {}) {
  let savedCategories = [...categories];
  let savedAccounts = [...accounts];
  const api = {
    get: jest.fn(async (path) => {
      if (path === "/categories") return { data: [...savedCategories] };
      if (path === "/accounts") return { data: [...savedAccounts] };
      throw new Error(`Unexpected API path: ${path}`);
    }),
  };
  const postCreate = jest.fn(async (path, payload) => {
    if (path === "/categories") {
      if (payload.name === failOnCategory) throw new Error("temporary network failure");
      if (payload.name === conflictingName) {
        savedCategories.push({
          ...payload, id: `concurrent-${payload.name}`, is_default: true,
        });
        throw { response: { status: 409 } };
      }
      if (savedCategories.some((item) => item.name === payload.name)) {
        throw { response: { status: 409 } };
      }
      savedCategories.push({ ...payload, id: String(savedCategories.length + 1) });
      return { data: savedCategories.at(-1) };
    }
    if (path === "/accounts") {
      savedAccounts.push({ ...payload, id: "new-main-wallet" });
      return { data: savedAccounts.at(-1) };
    }
    throw new Error("unexpected POST");
  });
  return { api, postCreate, saved: () => ({ categories: savedCategories, accounts: savedAccounts }) };
}

test("restores eleven expense categories and one zero-balance wallet without touching income", async () => {
  const existingIncome = [
    { id: "i1", name: "Salário", kind: "income", is_default: true },
    { id: "i2", name: "Freelance / Extra", kind: "income", is_default: true },
    { id: "i3", name: "Investimentos", kind: "income", is_default: true },
    { id: "i4", name: "Presente / Reembolso", kind: "income", is_default: true },
    { id: "i5", name: "Outras receitas", kind: "income", is_default: true },
  ];
  const backend = mockedBackend({ categories: existingIncome });
  const result = await restoreInitialFinanceDefaults({
    ...backend, currency: "EUR",
  });
  expect(result.createdCategories).toBe(11);
  expect(result.createdAccount).toBe(true);
  expect(result.categories.filter(c => c.kind === "expense")).toHaveLength(11);
  expect(result.categories.filter(c => c.kind === "income")).toHaveLength(5);
  expect(result.accounts).toEqual([expect.objectContaining({
    name: "Conta Principal",
    currency: "EUR",
    initial_balance: 0,
    type: "checking",
  })]);
  expect(backend.postCreate).toHaveBeenCalledTimes(12);
  expect(backend.postCreate).not.toHaveBeenCalledWith(
    expect.stringContaining("delete"), expect.anything(),
  );
});

test("does not duplicate categories or create a wallet when active one exists", async () => {
  const existing = [
    { id: "cat1", name: "Moradia", kind: "expense" },
    { id: "cat2", name: "MERCADO", kind: "expense" },
  ];
  const backend = mockedBackend({
    categories: existing,
    accounts: [{ id: "wallet1", name: "Minha carteira", currency: "EUR" }],
  });
  const result = await restoreInitialFinanceDefaults({
    ...backend, currency: "EUR",
  });
  expect(result.createdCategories).toBe(DEFAULT_EXPENSE_CATEGORIES.length - 2);
  expect(result.createdAccount).toBe(false);
  expect(backend.postCreate.mock.calls.some(([path]) => path === "/accounts")).toBe(false);
});

test("treats concurrent category creation as success after confirming it exists", async () => {
  const backend = mockedBackend({ conflictingName: "Moradia" });
  const result = await restoreInitialFinanceDefaults({ ...backend });
  expect(result.categories.filter(c => c.name === "Moradia")).toHaveLength(1);
  expect(result.createdCategories).toBe(10);
});

test("failed recovery is safe to retry and resumes from remaining categories", async () => {
  const backend = mockedBackend({ failOnCategory: "Transporte" });
  await expect(restoreInitialFinanceDefaults({ ...backend })).rejects.toThrow(
    "temporary network failure",
  );
  const current = backend.saved().categories;
  expect(current.map(c => c.name)).toEqual(["Moradia", "Mercado"]);
  const retry = mockedBackend({ categories: current });
  const result = await restoreInitialFinanceDefaults({ ...retry });
  expect(result.createdCategories).toBe(9);
  expect(result.categories.filter(c => c.kind === "expense")).toHaveLength(11);
});
