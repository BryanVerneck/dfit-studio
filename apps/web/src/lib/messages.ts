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
    case "same_session":
      return "Escolha uma aula diferente da atual.";
    case "pending_student_not_found":
      return "Este cadastro não está mais pendente.";
    case "forbidden":
      return "Você não tem permissão para isso.";
    case "session_not_found":
      return "Aula não encontrada.";
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
    case "fixed_limit_reached":
      return "Você já tem tantas aulas fixas quanto o seu plano permite. Fale com o estúdio para aumentar o limite.";
    case "already_enrolled":
      return "Você já tem horário fixo nessa turma.";
    case "request_pending":
      return "Você já fez esse pedido. Aguarde a resposta do estúdio.";
    case "request_not_found":
    case "request_not_pending":
      return "Este pedido já foi respondido ou cancelado.";
    case "slot_not_found":
      return "Esse horário não existe mais.";
    case "enrollment_not_found":
      return "Esse horário fixo não existe mais.";
    default:
      return "Algo deu errado. Tente de novo.";
  }
}

// The same errors as seen by the studio team, who act on someone else's behalf.
export function staffErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "weekly_limit_reached":
        return "Este aluno já usou todas as aulas desta semana.";
      case "already_booked":
        return "Este aluno já está nesta aula.";
      case "no_agreement":
        return "Este aluno ainda não tem um plano definido.";
      case "student_inactive":
      case "not_a_student":
        return "Este aluno não está ativo.";
      case "session_already_cancelled":
        return "Esta aula já foi cancelada.";
      case "booking_not_found":
      case "booking_not_active":
        return "Esta reserva não existe mais.";
      case "fixed_limit_reached":
        return "Este aluno já tem aulas fixas até o limite semanal. Aumente o limite primeiro.";
      case "already_enrolled":
        return "Este aluno já tem horário fixo nessa turma.";
      case "request_not_found":
      case "request_not_pending":
        return "Este pedido já foi respondido ou cancelado.";
      case "request_outdated":
        return "O horário fixo atual do aluno mudou. Recuse este pedido e peça um novo.";
      case "class_full":
        return "Esta turma está cheia.";
    }
  }
  return errorMessage(err);
}
