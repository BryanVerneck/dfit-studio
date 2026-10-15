import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { setAccessToken } from "./lib/api";

type Handler = (body: any) => { status?: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { path: string; body: any }[];

const me = { id: "u1", email: "ana@x.com", name: "Ana Souza", phone: null, gender: null, role: "student", studioId: "s1", mustChangePassword: false };
const session = (mustChangePassword = false) => ({ accessToken: "tok", expiresIn: 900, role: "student", studioId: "s1", mustChangePassword });

beforeEach(() => {
  setAccessToken(null);
  calls = [];
  routes = { "POST /auth/refresh": () => ({ status: 401, body: { error: "unauthorized" } }) };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, body });
      const handler = routes[`${init.method ?? "GET"} ${path}`];
      const res = handler ? handler(body) : { status: 404, body: { error: "not_found" } };
      return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderAt = (path: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );

describe("login", () => {
  it("sends anonymous visitors to the login page", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("validates before sending", async () => {
    renderAt("/entrar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Entrar" }));
    expect(screen.getByText("Informe seu e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Informe sua senha.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/auth/login")).toBe(false);
  });

  it("logs in and shows the home page", async () => {
    routes["POST /auth/login"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    renderAt("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@x.com");
    await user.type(screen.getByLabelText("Senha"), "secret123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/login")?.body).toMatchObject({ email: "ana@x.com", studioSlug: "dfit" });
  });

  it.each([
    [401, "invalid_credentials", "E-mail ou senha incorretos."],
    [403, "pending_approval", "Seu cadastro ainda está aguardando a aprovação do estúdio."],
    [429, "rate_limited", "Muitas tentativas. Aguarde um minuto e tente de novo."],
  ])("shows the error for %i %s", async (status, error, message) => {
    routes["POST /auth/login"] = () => ({ status, body: { error } });
    renderAt("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@x.com");
    await user.type(screen.getByLabelText("Senha"), "secret123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("shows a connection message when the network fails", async () => {
    renderAt("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@x.com");
    await user.type(screen.getByLabelText("Senha"), "secret123");
    (fetch as any).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conectar");
  });
});

describe("session", () => {
  it("restores the login from the refresh cookie, refreshing only once", async () => {
    routes["POST /auth/refresh"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
  });

  it("forces a temporary password to be changed", async () => {
    routes["POST /auth/refresh"] = () => ({ body: session(true) });
    routes["GET /me"] = () => ({ body: { ...me, mustChangePassword: true } });
    routes["POST /auth/change-password"] = () => {
      routes["GET /me"] = () => ({ body: me });
      return { body: session() };
    };
    renderAt("/");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Crie uma nova senha" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Senha atual"), "temp-pass-1");
    await user.type(screen.getByLabelText("Nova senha"), "brand-new-1");
    await user.type(screen.getByLabelText("Confirmar nova senha"), "brand-new-2");
    await user.click(screen.getByRole("button", { name: "Salvar senha" }));
    expect(screen.getByText("As senhas não são iguais.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Confirmar nova senha"));
    await user.type(screen.getByLabelText("Confirmar nova senha"), "brand-new-1");
    await user.click(screen.getByRole("button", { name: "Salvar senha" }));
    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/auth/change-password")?.body).toEqual({ currentPassword: "temp-pass-1", newPassword: "brand-new-1" });
  });

  it("logs out", async () => {
    routes["POST /auth/refresh"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    routes["POST /auth/logout"] = () => ({ status: 204 });
    renderAt("/");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });
});

describe("signup", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, email = "novo@x.com") {
    await user.type(await screen.findByLabelText("Nome"), "Novo Aluno");
    await user.type(screen.getByLabelText("E-mail"), email);
    await user.type(screen.getByLabelText("Senha"), "secret123");
    await user.type(screen.getByLabelText("Confirmar senha"), "secret123");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
  }

  it("rejects a short password and mismatched confirmation", async () => {
    renderAt("/cadastro");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Senha"), "abc");
    await user.type(screen.getByLabelText("Confirmar senha"), "abd");
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(screen.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("As senhas não são iguais.")).toBeInTheDocument();
    expect(screen.getByText("Informe seu nome.")).toBeInTheDocument();
  });

  it("registers and explains that approval is pending", async () => {
    routes["POST /auth/register"] = () => ({ status: 201, body: { status: "pending_approval" } });
    renderAt("/cadastro");
    await fill(userEvent.setup());
    expect(await screen.findByRole("heading", { name: "Cadastro enviado" })).toBeInTheDocument();
    const body = calls.find((c) => c.path === "/auth/register")?.body;
    expect(body).toMatchObject({ studioSlug: "dfit", email: "novo@x.com", name: "Novo Aluno", password: "secret123" });
    expect(body).not.toHaveProperty("phone");
  });

  it("tells the student when the e-mail is already used", async () => {
    routes["POST /auth/register"] = () => ({ status: 409, body: { error: "email_taken" } });
    renderAt("/cadastro");
    await fill(userEvent.setup());
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma conta com este e-mail.");
  });
});
