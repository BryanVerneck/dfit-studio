// Same limits as the backend, so most mistakes are caught before a request is sent.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const validateEmail = (value: string) => {
  const email = value.trim();
  if (!email) return "Informe seu e-mail.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Informe um e-mail válido.";
  return undefined;
};

export const validateNewPassword = (value: string) => {
  if (!value) return "Crie uma senha.";
  if (value.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (value.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  return undefined;
};

export const validateConfirmation = (password: string, confirmation: string) =>
  confirmation !== password ? "As senhas não são iguais." : undefined;
