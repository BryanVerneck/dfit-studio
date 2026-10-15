import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  routes = { "POST /auth/refresh": () => ({ status: 401, body: { error: "unauthorized" } }), "GET /sessions": () => ({ body: [] }), "GET /me/weekly-usage": () => ({ body: { weekStart: "x", used: 0, weeklyLimit: 3, remaining: 3 } }) };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ path, body });
      const handler = routes[`${init.method ?? "GET"} ${path}`] ?? routes[`${init.method ?? "GET"} ${path.split("?")[0]}`];
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

describe("week view", () => {
  // Wednesday 14 Oct 2026, 09:00 in São Paulo.
  const at = (hour: string, day = "2026-10-14") => `${day}T${hour}:00-03:00`;
  const klass = (id: string, startsAt: string, extra = {}) => ({
    id, slotId: "sl", name: "Treino", startsAt, durationMin: 60, capacity: 8, spotsLeft: 4, status: "scheduled", cancelNote: null, myBookingId: null, ...extra,
  });
  let list: any[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
    list = [klass("a", at("07:00")), klass("b", at("18:00")), klass("c", at("19:00"), { spotsLeft: 0 }), klass("d", at("07:00", "2026-10-15"))];
    routes["POST /auth/refresh"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    routes["GET /me/weekly-usage?date=2026-10-12"] = () => ({ body: { weekStart: "2026-10-12", used: 1, weeklyLimit: 3, remaining: 2 } });
    routes["GET /sessions?from=2026-10-11&to=2026-10-17"] = () => ({ body: list });
  });
  afterEach(() => vi.useRealTimers());

  it("shows today's classes with spots and the weekly usage", async () => {
    renderAt("/");
    expect(await screen.findByText("Você usou 1 de 3 aulas nesta semana.")).toBeInTheDocument();
    expect(await screen.findByText("07:00")).toBeInTheDocument();
    expect(screen.getAllByText("4 vagas").length).toBeGreaterThan(0);
    expect(screen.getByText("Lotada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sem vagas" })).toBeDisabled();
    expect(screen.queryByText("07:00", { selector: "p" })).toBeInTheDocument();
  });

  it("lists the week from Sunday to Saturday", async () => {
    renderAt("/");
    await screen.findByText("18:00");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["dom11", "seg12", "ter13", "qua14", "qui15", "sex16", "sáb17"]);
  });

  it("switches day", async () => {
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByText("18:00");
    await user.click(screen.getByRole("tab", { name: /Quinta-feira/ }));
    expect(screen.queryByText("18:00")).not.toBeInTheDocument();
    expect(screen.getByText("07:00")).toBeInTheDocument();
  });

  it("books a class and shows it as booked", async () => {
    routes["POST /bookings"] = (body) => {
      list = list.map((s) => (s.id === body.sessionId ? { ...s, spotsLeft: 3, myBookingId: "bk1" } : s));
      return { status: 201, body: { booking: { id: "bk1" } } };
    };
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByText("18:00");
    await user.click(screen.getByRole("button", { name: "Reservar" }));
    expect(await screen.findByText("✓ Você está nesta aula")).toBeInTheDocument();
    expect(await screen.findByText("Reserva confirmada.")).toBeInTheDocument();
    const call = calls.find((c) => c.path === "/bookings");
    expect(call?.body).toMatchObject({ sessionId: "b" });
    expect(call?.body.idempotencyKey).toBeTruthy();
  });

  it("explains a failed booking and refreshes the list", async () => {
    routes["POST /bookings"] = () => {
      list = list.map((s) => (s.id === "b" ? { ...s, spotsLeft: 0 } : s));
      return { status: 409, body: { error: "class_full" } };
    };
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByText("18:00");
    await user.click(screen.getByRole("button", { name: "Reservar" }));
    expect(await screen.findByText("Esta aula já está lotada.", { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Sem vagas" })).toHaveLength(2));
  });

  it("cancels a booking after confirmation", async () => {
    list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: "bk1", spotsLeft: 3 } : s));
    routes["DELETE /bookings/bk1"] = () => {
      list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: null, spotsLeft: 4 } : s));
      return { body: { booking: { id: "bk1" } } };
    };
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByText("✓ Você está nesta aula");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Manter" }));
    expect(calls.some((c) => c.path === "/bookings/bk1")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await screen.findByRole("button", { name: "Reservar" })).toBeInTheDocument();
    expect(await screen.findByText("Reserva cancelada.")).toBeInTheDocument();
    expect(screen.queryByText("✓ Você está nesta aula")).not.toBeInTheDocument();
  });

  it("explains when it is too late to cancel", async () => {
    list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: "bk1" } : s));
    routes["DELETE /bookings/bk1"] = () => ({ status: 409, body: { error: "too_late_to_cancel" } });
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    expect(await screen.findByText("Já passou do prazo para cancelar", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("✓ Você está nesta aula")).toBeInTheDocument();
  });

  it("swaps a booking to another class", async () => {
    list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: "bk1", spotsLeft: 3 } : s));
    routes["POST /bookings/bk1/swap"] = (body) => {
      list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: null, spotsLeft: 4 } : s.id === body.toSessionId ? { ...s, myBookingId: "bk2" } : s));
      return { status: 201, body: { booking: { id: "bk2" } } };
    };
    list = [...list, klass("e", at("20:00"), { spotsLeft: 2 })];
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole("button", { name: "Trocar" }));
    expect(screen.getByText(/Trocando a aula de quarta-feira às 18:00/)).toBeInTheDocument();
    expect(screen.getByText("Aula atual")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Trocar para esta" }));
    expect(await screen.findByText("✓ Você está nesta aula")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/bookings/bk1/swap")?.body).toMatchObject({ toSessionId: "e" });
    expect(screen.queryByText(/Trocando a aula/)).not.toBeInTheDocument();
    expect(await screen.findByText("Aula trocada.")).toBeInTheDocument();
  });

  it("keeps the original class when the swap fails", async () => {
    list = list.map((s) => (s.id === "b" ? { ...s, myBookingId: "bk1" } : s));
    list = [...list, klass("e", at("20:00"))];
    routes["POST /bookings/bk1/swap"] = () => ({ status: 409, body: { error: "weekly_limit_reached" } });
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole("button", { name: "Trocar" }));
    await user.click(screen.getByRole("button", { name: "Trocar para esta" }));
    expect(await screen.findByText("Você já usou todas as aulas desta semana.", { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desistir da troca" }));
    expect(screen.getByText("✓ Você está nesta aula")).toBeInTheDocument();
  });

  it("loads another week", async () => {
    routes["GET /me/weekly-usage?date=2026-10-19"] = () => ({ body: { weekStart: "2026-10-19", used: 0, weeklyLimit: 3, remaining: 3 } });
    routes["GET /sessions?from=2026-10-18&to=2026-10-24"] = () => ({ body: [] });
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await screen.findByText("18:00");
    await user.click(screen.getByRole("button", { name: "Próxima semana" }));
    expect(await screen.findByText("Nenhuma aula neste dia.")).toBeInTheDocument();
    expect(screen.getByText("Você usou 0 de 3 aulas nesta semana.")).toBeInTheDocument();
  });
});

describe("staff approvals", () => {
  const staff = { ...me, id: "st1", name: "Bia Staff", role: "owner" };
  const pendingList = [{ userId: "u9", name: "Novo Aluno", email: "novo@x.com", phone: "11 99999-0000", requestedAt: "2026-10-14T12:00:00Z" }];
  let pending: typeof pendingList;

  beforeEach(() => {
    pending = [...pendingList];
    routes["POST /auth/refresh"] = () => ({ body: { ...session(), role: "owner" } });
    routes["GET /me"] = () => ({ body: staff });
    routes["GET /staff/pending-students"] = () => ({ body: pending });
  });

  it("approves a student with a weekly limit", async () => {
    routes["POST /staff/students/u9/approve"] = () => {
      pending = [];
      return { body: { studentId: "s9" } };
    };
    routes["POST /staff/students/s9/agreement"] = () => ({ body: { agreement: {} } });
    renderAt("/equipe/aprovacoes");
    const user = userEvent.setup();
    expect(await screen.findByText("Novo Aluno")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    await user.click(screen.getByLabelText("Aulas por semana"));
    await user.click(screen.getByRole("option", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Novo Aluno foi aprovado(a).")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum cadastro pendente.")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/staff/students/s9/agreement")?.body).toEqual({ weeklyLimit: 4 });
  });

  it("shows a message when the signup is no longer pending", async () => {
    routes["POST /staff/students/u9/approve"] = () => ({ status: 404, body: { error: "pending_student_not_found" } });
    renderAt("/equipe/aprovacoes");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Este cadastro não está mais pendente.")).toBeInTheDocument();
  });

  it("links to approvals from the home page for staff only", async () => {
    routes["GET /sessions"] = () => ({ body: [] });
    renderAt("/");
    expect(await screen.findByRole("link", { name: "Aprovações" })).toBeInTheDocument();
  });

  it("sends students away from the approvals page", async () => {
    routes["POST /auth/refresh"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    renderAt("/equipe/aprovacoes");
    expect(await screen.findByRole("heading", { name: "Olá, Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aprovações" })).not.toBeInTheDocument();
  });
});

describe("staff students", () => {
  const staff = { ...me, id: "st1", name: "Bia Staff", role: "owner" };
  let rows: { studentId: string; userId: string; name: string; email: string; phone: string | null; weeklyLimit: number | null }[];

  beforeEach(() => {
    rows = [
      { studentId: "s1", userId: "u1", name: "Ana Souza", email: "ana@x.com", phone: null, weeklyLimit: 3 },
      { studentId: "s2", userId: "u2", name: "Bruno Dias", email: "bruno@x.com", phone: "11 90000-0000", weeklyLimit: null },
    ];
    routes["POST /auth/refresh"] = () => ({ body: { ...session(), role: "owner" } });
    routes["GET /me"] = () => ({ body: staff });
    routes["GET /staff/students"] = () => ({ body: rows });
  });

  it("lists students with their limits and filters by search", async () => {
    renderAt("/equipe/alunos");
    const user = userEvent.setup();
    expect(await screen.findByText("3 aulas por semana")).toBeInTheDocument();
    expect(screen.getByText("Sem plano definido")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Buscar por nome ou e-mail"), "bruno");
    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.getByText("Bruno Dias")).toBeInTheDocument();
  });

  it("changes a weekly limit", async () => {
    routes["POST /staff/students/s2/agreement"] = (body) => {
      rows = rows.map((r) => (r.studentId === "s2" ? { ...r, weeklyLimit: body.weeklyLimit } : r));
      return { body: { agreement: {} } };
    };
    renderAt("/equipe/alunos");
    const user = userEvent.setup();
    await screen.findByText("Bruno Dias");
    await user.click(screen.getAllByRole("button", { name: "Alterar limite" })[1]);
    await user.click(screen.getByLabelText("Aulas por semana"));
    await user.click(screen.getByRole("option", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("2 aulas por semana")).toBeInTheDocument();
    expect(await screen.findByText("Limite de Bruno Dias atualizado.")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/staff/students/s2/agreement")?.body).toEqual({ weeklyLimit: 2 });
  });

  it("asks before generating a temporary password, then shows it once", async () => {
    routes["POST /staff/users/u1/temporary-password"] = () => ({ body: { temporaryPassword: "Tmp-Pass-123" } });
    renderAt("/equipe/alunos");
    const user = userEvent.setup();
    await screen.findByText("Ana Souza");
    await user.click(screen.getAllByRole("button", { name: "Senha temporária" })[0]);
    expect(calls.some((c) => c.path.includes("temporary-password"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Gerar senha" }));
    expect(await screen.findByText("Tmp-Pass-123")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("Tmp-Pass-123")).not.toBeInTheDocument();
  });

  it("shows an error toast when the reset is not allowed", async () => {
    routes["POST /staff/users/u1/temporary-password"] = () => ({ status: 403, body: { error: "forbidden" } });
    renderAt("/equipe/alunos");
    const user = userEvent.setup();
    await screen.findByText("Ana Souza");
    await user.click(screen.getAllByRole("button", { name: "Senha temporária" })[0]);
    await user.click(screen.getByRole("button", { name: "Gerar senha" }));
    expect(await screen.findByText("Você não tem permissão para isso.")).toBeInTheDocument();
  });
});

describe("class detail for staff", () => {
  const staff = { ...me, id: "st1", name: "Bia Staff", role: "owner" };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
    routes["POST /auth/refresh"] = () => ({ body: { ...session(), role: "owner" } });
    routes["GET /me"] = () => ({ body: staff });
  });
  afterEach(() => vi.useRealTimers());

  it("opens a class from the schedule and lists its students", async () => {
    routes["GET /sessions"] = () => ({
      body: [
        { id: "c1", slotId: "sl", name: "Treino", startsAt: "2026-10-14T21:00:00-03:00", durationMin: 60, capacity: 8, spotsLeft: 6, status: "scheduled", cancelNote: null, myBookingId: null },
        { id: "c2", slotId: "sl", name: "Treino", startsAt: "2026-10-14T22:00:00-03:00", durationMin: 60, capacity: 8, spotsLeft: 8, status: "cancelled", cancelNote: null, myBookingId: null },
      ],
    });
    routes["GET /staff/sessions/c1/roster"] = () => ({
      body: {
        session: { id: "c1", name: "Treino", startsAt: "2026-10-14T21:00:00-03:00", capacity: 8, bookedCount: 2, status: "scheduled" },
        roster: [
          { bookingId: "b1", studentId: "s1", name: "Ana Souza", phone: "11 91111-1111", source: "standing" },
          { bookingId: "b2", studentId: "s2", name: "Bruno Dias", phone: null, source: "one_off" },
        ],
      },
    });
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    expect(await screen.findByText("Aula cancelada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reservar" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "Ver alunos" })[0]);
    expect(await screen.findByRole("heading", { name: "21:00 · Treino" })).toBeInTheDocument();
    expect(screen.getByText("2 de 8")).toBeInTheDocument();
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("Horário fixo")).toBeInTheDocument();
    expect(screen.getByText("Avulsa")).toBeInTheDocument();
  });

  it("shows an error when the class does not exist", async () => {
    routes["GET /staff/sessions/nope/roster"] = () => ({ status: 404, body: { error: "session_not_found" } });
    renderAt("/equipe/aulas/nope");
    expect(await screen.findByRole("alert")).toHaveTextContent("Aula não encontrada.");
  });

  describe("actions", () => {
    let roster: { bookingId: string; studentId: string; name: string; phone: string | null; source: string }[];
    let status: string;
    const everyone = [
      { studentId: "s1", userId: "u1", name: "Ana Souza", email: "ana@x.com", phone: null, weeklyLimit: 3 },
      { studentId: "s2", userId: "u2", name: "Bruno Dias", email: "bruno@x.com", phone: null, weeklyLimit: 3 },
      { studentId: "s3", userId: "u3", name: "Carla Lima", email: "carla@x.com", phone: "11 95555-5555", weeklyLimit: 3 },
    ];

    beforeEach(() => {
      status = "scheduled";
      roster = [
        { bookingId: "b1", studentId: "s1", name: "Ana Souza", phone: "11 91111-1111", source: "standing" },
        { bookingId: "b2", studentId: "s2", name: "Bruno Dias", phone: null, source: "one_off" },
      ];
      routes["GET /staff/sessions/c1/roster"] = () => ({
        body: { session: { id: "c1", name: "Treino", startsAt: "2026-10-14T21:00:00-03:00", capacity: 8, bookedCount: roster.length, status }, roster },
      });
      routes["GET /staff/students"] = () => ({ body: everyone });
    });

    it("adds a student who is not in the class yet", async () => {
      routes["POST /staff/bookings"] = (body) => {
        const s = everyone.find((e) => e.studentId === body.studentId)!;
        roster = [...roster, { bookingId: "b3", studentId: s.studentId, name: s.name, phone: s.phone, source: "one_off" }];
        return { status: 201, body: { booking: { id: "b3" } } };
      };
      renderAt("/equipe/aulas/c1");
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.click(await screen.findByRole("button", { name: "Adicionar aluno" }));
      expect(await screen.findByRole("button", { name: "Adicionar Carla Lima" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Adicionar Ana Souza" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Adicionar Carla Lima" }));
      expect(await screen.findByText("3 de 8")).toBeInTheDocument();
      expect(calls.find((c) => c.path === "/staff/bookings")?.body).toEqual({ sessionId: "c1", studentId: "s3" });
    });

    it("explains when the student cannot take another class", async () => {
      routes["POST /staff/bookings"] = () => ({ status: 409, body: { error: "weekly_limit_reached" } });
      renderAt("/equipe/aulas/c1");
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.click(await screen.findByRole("button", { name: "Adicionar aluno" }));
      await user.click(await screen.findByRole("button", { name: "Adicionar Carla Lima" }));
      expect((await screen.findAllByText("Este aluno já usou todas as aulas desta semana.")).length).toBeGreaterThan(0);
      expect(screen.getByText("2 de 8")).toBeInTheDocument();
    });

    it("removes a student after confirmation", async () => {
      routes["DELETE /bookings/b2"] = () => {
        roster = roster.filter((r) => r.bookingId !== "b2");
        return { body: { booking: { id: "b2" } } };
      };
      renderAt("/equipe/aulas/c1");
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.click((await screen.findAllByRole("button", { name: "Remover" }))[1]);
      expect(calls.some((c) => c.path === "/bookings/b2")).toBe(false);
      await user.click(screen.getByRole("button", { name: "Sim, remover" }));
      expect(await screen.findByText("1 de 8")).toBeInTheDocument();
      expect(screen.queryByText("Bruno Dias")).not.toBeInTheDocument();
    });

    it("cancels the class and lists the students to tell", async () => {
      routes["POST /staff/sessions/c1/cancel"] = (body) => {
        status = "cancelled";
        const affected = roster.map((r) => ({ studentId: r.studentId, name: r.name, phone: r.phone }));
        roster = [];
        return { body: { sessionId: "c1", bookingsCancelled: affected.length, affected, note: body.note } };
      };
      renderAt("/equipe/aulas/c1");
      const user = userEvent.setup({ advanceTimers: () => {} });
      await user.click(await screen.findByRole("button", { name: "Cancelar aula" }));
      await user.type(screen.getByLabelText(/Motivo/), "Feriado");
      await user.click(screen.getByRole("button", { name: "Sim, cancelar aula" }));
      expect(await screen.findByText("Avise estes 2 alunos:")).toBeInTheDocument();
      expect(screen.getByText(/11 91111-1111/)).toBeInTheDocument();
      expect(calls.find((c) => c.path === "/staff/sessions/c1/cancel")?.body).toEqual({ note: "Feriado" });
      expect(screen.queryByRole("button", { name: "Adicionar aluno" })).not.toBeInTheDocument();
    });

    it("offers no actions for a class that was already cancelled", async () => {
      status = "cancelled";
      roster = [];
      renderAt("/equipe/aulas/c1");
      expect(await screen.findByText("Aula cancelada")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancelar aula" })).not.toBeInTheDocument();
    });
  });
});

describe("new student", () => {
  const staff = { id: "st1", email: "bia@x.com", name: "Bia Staff", role: "owner", studioId: "studio1", mustChangePassword: false };

  beforeEach(() => {
    routes["POST /auth/refresh"] = () => ({ body: { ...session(), role: "owner" } });
    routes["GET /me"] = () => ({ body: staff });
    routes["GET /staff/students"] = () => ({ body: [] });
  });

  it("creates a student and shows the temporary password once", async () => {
    routes["POST /staff/students"] = () => ({ status: 201, body: { userId: "u9", studentId: "s9", temporaryPassword: "Tmp-Pass-999" } });
    renderAt("/equipe/alunos");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Novo aluno" }));
    await user.type(screen.getByLabelText("Nome"), "Carla Dias");
    await user.type(screen.getByLabelText("E-mail"), "Carla@X.com");
    await user.click(screen.getByLabelText("Aulas por semana"));
    await user.click(screen.getByRole("option", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "Cadastrar aluno" }));
    expect(await screen.findByText("Tmp-Pass-999")).toBeInTheDocument();
    expect(screen.getByText("Carla Dias foi cadastrado.")).toBeInTheDocument();
    expect(calls.find((c) => c.path === "/staff/students" && c.body)?.body).toEqual({ name: "Carla Dias", email: "Carla@X.com", weeklyLimit: 2 });
    await user.click(screen.getByRole("button", { name: "Cadastrar outro" }));
    expect(screen.queryByText("Tmp-Pass-999")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("");
  });

  it("checks the form and reports an e-mail that is already in use", async () => {
    routes["POST /staff/students"] = () => ({ status: 409, body: { error: "email_taken" } });
    renderAt("/equipe/alunos/novo");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cadastrar aluno" }));
    expect(screen.getByText("Informe o nome.")).toBeInTheDocument();
    expect(screen.getByText("Informe seu e-mail.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/staff/students" && c.body)).toBe(false);
    await user.type(screen.getByLabelText("Nome"), "Carla");
    await user.type(screen.getByLabelText("E-mail"), "carla@x.com");
    await user.click(screen.getByRole("button", { name: "Cadastrar aluno" }));
    expect(await screen.findByText("Já existe um aluno com este e-mail.")).toBeInTheDocument();
  });
});

describe("my bookings", () => {
  const at = (day: string, hour: string) => `${day}T${hour}:00-03:00`;
  const booking = (id: string, startsAt: string, extra = {}) => ({
    id, sessionId: `s-${id}`, source: "standing", status: "booked", cancelReason: null, cancelNote: null, name: "Treino", startsAt, durationMin: 60, ...extra,
  });
  let list: any[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T12:00:00Z") });
    list = [
      booking("early", at("2026-10-14", "07:00")),
      booking("a", at("2026-10-15", "07:00")),
      booking("b", at("2026-10-15", "18:00"), { source: "one_off" }),
      booking("c", at("2026-10-16", "07:00"), { status: "cancelled", cancelReason: "class_cancelled", cancelNote: "Feriado" }),
    ];
    routes["POST /auth/refresh"] = () => ({ body: session() });
    routes["GET /me"] = () => ({ body: me });
    routes["GET /me/bookings"] = () => ({ body: list });
  });
  afterEach(() => vi.useRealTimers());

  it("lists upcoming classes by day and leaves out the ones that already ended", async () => {
    renderAt("/minhas-aulas");
    expect(await screen.findByText("Quinta-feira, 15 de outubro")).toBeInTheDocument();
    expect(screen.getByText("Sexta-feira, 16 de outubro")).toBeInTheDocument();
    expect(screen.queryByText("Quarta-feira, 14 de outubro")).not.toBeInTheDocument();
    expect(screen.getAllByText("Horário fixo").length).toBeGreaterThan(0);
    expect(screen.getByText("Avulsa")).toBeInTheDocument();
    expect(screen.getByText("Aula cancelada pelo estúdio: Feriado")).toBeInTheDocument();
  });

  it("cancels a booking after confirmation", async () => {
    routes["DELETE /bookings/a"] = () => {
      list = list.filter((b) => b.id !== "a");
      return { body: { booking: { id: "a" } } };
    };
    renderAt("/minhas-aulas");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click((await screen.findAllByRole("button", { name: "Cancelar" }))[0]);
    expect(calls.some((c) => c.path === "/bookings/a")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Sim, cancelar" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/bookings/a")).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1));
  });

  it("shows an empty message and a tab to move between screens", async () => {
    list = [];
    renderAt("/");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole("link", { name: "Minhas aulas" }));
    expect(await screen.findByText("Você não tem aulas reservadas.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Aulas" }));
    expect(await screen.findByRole("heading", { name: /Olá/ })).toBeInTheDocument();
  });

  it("sends the studio team back to the class list", async () => {
    routes["POST /auth/refresh"] = () => ({ body: { ...session(), role: "owner" } });
    routes["GET /me"] = () => ({ body: { ...me, role: "owner" } });
    renderAt("/minhas-aulas");
    expect(await screen.findByRole("heading", { name: /Olá/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Minhas aulas" })).not.toBeInTheDocument();
  });
});
