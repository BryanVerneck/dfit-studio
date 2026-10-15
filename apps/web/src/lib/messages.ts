import { ApiError } from "./api";

// Turns a failed request into a sentence for the student, in Portuguese.
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Algo deu errado. Tente de novo.";
  if (err.status === 0) return "Não foi possível conectar. Verifique sua internet e tente de novo.";
  if (err.status === 429) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
  switch (err.code) {
    case "invalid_credentials":
      return "E-mail ou senha incorretos.";
    case "pending_approval":
      return "Seu cadastro ainda está aguardando a aprovação do estúdio.";
    case "no_access":
      return "Você não tem acesso a este estúdio. Fale com o estúdio.";
    case "studio_required":
      return "Não foi possível identificar o estúdio. Fale com o estúdio.";
    case "email_taken":
      return "Já existe uma conta com este e-mail. Tente entrar.";
    case "studio_not_found":
      return "Estúdio não encontrado. Fale com o estúdio.";
    case "invalid_request":
      return "Confira os dados e tente de novo.";
    default:
      return "Algo deu errado. Tente de novo.";
  }
}
