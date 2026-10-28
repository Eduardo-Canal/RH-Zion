export type PrincipalInstance = {
  id: string
  nome: string
  instance_key: string | null
  instance_token: string | null
  status: string
}

export type PrincipalLookup = PrincipalInstance | null

export type PrincipalValidation =
  | { ok: true; principal: PrincipalInstance }
  | { ok: false; status: 422 | 409 | 500 | 503; code: string; message: string }

// Quem cria o grupo e quem fica gravado em whatsapp_group_config precisam ser
// a MESMA consulta — resolvida uma única vez aqui, antes de chamar a uazapi.
// A principal (não "a mais antiga ativa") porque é o número mantido no ar;
// "mais antiga" muda sozinha conforme instâncias entram e saem (foi assim que
// o defeito original nasceu). Sem fallback pra outra instância, nem pro token
// global, se a principal não servir — falha explícita em cada caso. Fallback
// pro token global é seguro em outras functions porque elas mandam
// `instanceName` no corpo pra uazapi saber qual instância agir; aqui a
// chamada (/group/create) não manda, então token global = instância
// indeterminada criando o grupo enquanto o banco grava a principal.
export function validatePrincipalInstance(
  principal: PrincipalLookup,
  lookupError?: { message: string } | null,
): PrincipalValidation {
  if (lookupError) {
    return {
      ok: false,
      status: 500,
      code: 'PRINCIPAL_LOOKUP_ERROR',
      message: 'Erro ao buscar instância principal: ' + lookupError.message,
    }
  }
  if (!principal) {
    return {
      ok: false,
      status: 422,
      code: 'PRINCIPAL_NOT_FOUND',
      message:
        'Nenhuma instância principal ativa. Configure uma antes de criar a feira.',
    }
  }
  if (principal.status !== 'conectado') {
    return {
      ok: false,
      status: 409,
      code: 'PRINCIPAL_DISCONNECTED',
      message: `Instância principal "${principal.nome}" está desconectada. Reconecte em Configurações > WhatsApp antes de criar o grupo.`,
    }
  }
  if (!principal.instance_token?.trim()) {
    return {
      ok: false,
      status: 503,
      code: 'PRINCIPAL_NO_TOKEN',
      message: `Instância principal "${principal.nome}" não tem token próprio configurado. Salve o token em Configurações > WhatsApp antes de criar o grupo.`,
    }
  }
  return { ok: true, principal }
}

export function buildGroupConfigInsert(
  groupId: string,
  nome: string,
  principal: { id: string },
): { group_id: string; nome: string; ativo: true; instance_id: string } {
  return { group_id: groupId, nome, ativo: true, instance_id: principal.id }
}
