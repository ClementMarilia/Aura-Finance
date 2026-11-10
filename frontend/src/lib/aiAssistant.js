import "@/i18n/ai";
import { translate as tr } from "@/i18n";

const ERRORS = {
  AI_NOT_CONFIGURED: "A IA ainda não foi configurada pela administradora.",
  AI_PAYMENT_NOT_CONFIGURED: "As instruções de pagamento ainda não foram configuradas.",
  AI_REQUEST_EXISTS: "Já existe uma solicitação ou um plano ativo.",
  AI_REQUEST_CHANGED: "Esta solicitação mudou. Atualize a página.",
  AI_CONFIRM_PAYMENT: "Confirme o recebimento do pagamento antes de ativar.",
  AI_INPUT_TOO_LONG: "Envie um comando mais curto.",
  AI_CONNECTION_REQUIRED: "Configure sua conexão de IA antes de usar.",
  AI_KEY_REQUIRED: "Informe a chave do provedor selecionado.",
  AI_KEY_REJECTED: "O provedor recusou a chave. Confira suas credenciais e permissões.",
  AI_PROVIDER_LIMIT: "O provedor atingiu um limite. Tente depois ou altere sua conexão.",
  AI_PROVIDER_UNAVAILABLE: "O provedor de IA está indisponível. Tente novamente mais tarde.",
  AI_INVALID_RESPONSE: "A IA não retornou um lançamento válido. Revise o texto e tente novamente.",
  AI_INPUT_REQUIRED: "Envie um texto ou uma gravação.",
  AI_AUDIO_INVALID: "Grave um áudio de até 30 segundos.",
  AI_PLAN_LIMIT: "Plano inativo, vencido ou limite de uso atingido. Confira suas configurações.",
  AI_BUSY: "Aguarde alguns segundos antes de enviar outro comando.",
  AI_CONTEXT_TOO_LARGE: "Há muitas categorias ou contas para esta consulta. Use o formulário manual.",
};

export function aiError(error) {
  const code = error?.response?.data?.detail;
  return tr(ERRORS[code] || "Não foi possível concluir. Tente novamente.");
}

export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const PLAN_STATUS = {
  pending: "Aguardando pagamento",
  payment_reported: "Pagamento informado; aguardando confirmação",
  active: "Ativo",
  rejected: "Rejeitado",
  suspended: "Suspenso",
};
