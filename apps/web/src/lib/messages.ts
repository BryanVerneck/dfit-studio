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
    case "too_late_to_cancel":
      return "Já passou do prazo para cancelar esta aula. Fale com o estúdio.";
    case "booking_not_active":
      return "Esta reserva já foi cancelada.";
    case "class_full":
      return "Esta aula já está lotada.";
    case "already_booked":
      return "Você já está nesta aula.";
    case "weekly_limit_reached":
      return "Você já usou todas as aulas desta semana.";
    case "no_agreement":
      return "Seu plano ainda não foi configurado. Fale com o estúdio.";
    case "class_started":
      return "Esta aula já começou.";
    case "session_cancelled":
      return "Esta aula foi cancelada.";
    case "outside_booking_window":
      return "Ainda não é possível reservar esta data.";
    case "student_inactive":
    case "not_a_student":
      return "Sua conta não pode reservar aulas. Fale com o estúdio.";
    default:
      return "Algo deu errado. Tente de novo.";
  }
}
