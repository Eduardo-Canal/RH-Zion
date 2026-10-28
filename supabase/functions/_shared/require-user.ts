import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { corsHeaders } from './cors.ts'

function jsonResp(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export type RequireUserResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response }

// Guard de usuário — extrai a identidade do JWT validado (Authorization
// header), nunca de um campo do body. Chamar ANTES de req.json() e de
// qualquer efeito colateral (mesmo padrão do guard de bitrix-rate-limiter /
// whatsapp-manage-instance).
export async function requireUser(req: Request): Promise<RequireUserResult> {
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader) {
    return {
      ok: false,
      response: jsonResp(401, {
        ok: false,
        error: 'TOKEN_AUSENTE',
        mensagem: 'Token ausente',
      }),
    }
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!anonKey) {
    console.error(
      '[require-user] SUPABASE_ANON_KEY não configurado — recusando execução.',
    )
    return {
      ok: false,
      response: jsonResp(500, {
        ok: false,
        error: 'CONFIG_ERROR',
        mensagem: 'Configuração interna ausente',
      }),
    }
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    anonKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data?.user) {
    return {
      ok: false,
      response: jsonResp(401, {
        ok: false,
        error: 'TOKEN_INVALIDO',
        mensagem: 'Token inválido',
      }),
    }
  }

  return { ok: true, userId: data.user.id }
}

// true somente se Authorization === Bearer <SUPABASE_SERVICE_ROLE_KEY>.
// Secret vazio nunca libera geral.
export function isServiceRoleCall(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!serviceRoleKey) return false
  const authHeader = req.headers.get('Authorization') || ''
  return authHeader === `Bearer ${serviceRoleKey}`
}
