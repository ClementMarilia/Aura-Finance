const mockPost = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    create: () => ({
      post: (...args) => mockPost(...args),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    }),
  },
}));

import axios from "axios";
import { postCreate, refreshAccessToken } from "./api";


describe("postCreate", () => {
  beforeEach(() => {
    mockPost.mockReset();
    sessionStorage.clear();
  });

  test("reuses one idempotency key for concurrent identical creates", async () => {
    mockPost.mockResolvedValue({ data: { id: "transaction-1" } });

    const payload = { amount: 25, description: "Mercado" };
    await Promise.all([
      postCreate("/transactions", payload),
      postCreate("/transactions", payload),
    ]);

    expect(mockPost).toHaveBeenCalledTimes(2);
    const firstHeaders = mockPost.mock.calls[0][2].headers;
    const secondHeaders = mockPost.mock.calls[1][2].headers;
    expect(firstHeaders["Idempotency-Key"]).toBe(
      secondHeaders["Idempotency-Key"]
    );
    expect(sessionStorage.length).toBe(0);
  });

  test("keeps the key after a lost response and reuses it on retry", async () => {
    mockPost
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce({ data: { id: "account-1" } });

    const payload = { name: "Principal", initial_balance: 0 };
    await expect(postCreate("/accounts", payload)).rejects.toThrow(
      "network failure"
    );
    const firstKey = mockPost.mock.calls[0][2].headers["Idempotency-Key"];

    await postCreate("/accounts", payload);
    const retryKey = mockPost.mock.calls[1][2].headers["Idempotency-Key"];

    expect(retryKey).toBe(firstKey);
    expect(sessionStorage.length).toBe(0);
  });
});


describe("refreshAccessToken", () => {
  afterEach(() => {
    delete navigator.locks;
    jest.restoreAllMocks();
  });

  test("retries 409 conflicts caused by another tab rotating the cookie", async () => {
    jest.spyOn(global, "setTimeout").mockImplementation((fn) => { fn(); return 0; });
    const conflict = { response: { status: 409 } };
    axios.post
      .mockReset()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ data: { token: "new", user: { id: "u1" } } });

    const data = await refreshAccessToken();

    expect(data.token).toBe("new");
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  test("serializes refreshes across tabs with a Web Lock when available", async () => {
    const request = jest.fn((name, task) => task());
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    axios.post.mockReset().mockResolvedValue({ data: { token: "t", user: {} } });

    await refreshAccessToken();

    expect(request).toHaveBeenCalledWith("crelith-auth-refresh", expect.any(Function));
  });
});
