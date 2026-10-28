import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    // Uso da chave Service Role para executar operações de background em todos os usuários
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // 1. Obter leads que precisam de follow-up usando a nova RPC
    const { data: dueFollowups, error: fetchError } =
      await supabaseAdmin.rpc('get_due_followups')

    if (fetchError) {
      throw new Error(
        `Erro ao buscar leads para follow-up: ${fetchError.message}`,
      )
    }

    if (!dueFollowups || dueFollowups.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Nenhum lead necessita de follow-up neste momento.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    let processedCount = 0

    // 2. Processar cada lead pendente
    for (const lead of dueFollowups) {
      const typeLabels: Record<string, string> = {
        follow_up: 'Prospecção (Follow-up)',
        proposal: 'Proposta (Follow-up)',
        closing: 'Fechamento',
      }

      const label = typeLabels[lead.reminder_type] || 'Contato'
      const title = `Lembrete: ${label}`
      const message = `O lead ${lead.razao_social || 'Desconhecido'} está há ${lead.dias_sem_contato} dias sem registro de interação. Retome o contato!`

      // A. Inserir Notificação no Dashboard (Badge e Sino)
      const { error: notifyError } = await supabaseAdmin
        .from('notifications')
        .insert({
          user_id: lead.user_id,
          title,
          message,
        })

      if (notifyError) {
        console.error(
          `Erro ao criar notificação para user ${lead.user_id}:`,
          notifyError,
        )
        continue
      }

      // B. Atualizar (Upsert) o controle na tabela `reminders` para evitar enviar o mesmo alerta hoje
      await supabaseAdmin.from('reminders').upsert(
        {
          lead_id: lead.lead_id,
          user_id: lead.user_id,
          reminder_type: lead.reminder_type,
          days_interval: lead.dias_sem_contato, // Armazenando o atraso atual no momento do disparo
          last_reminded_at: new Date().toISOString(),
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id', ignoreDuplicates: false },
      )

      // C. Disparo do Email para o Executivo Responsável
      // MOCK DE INTEGRAÇÃO DE E-MAIL
      // Aqui você poderia integrar com a API do Resend, SendGrid ou AWS SES.
      console.log(`
==================================================
[SIMULATED EMAIL DISPATCH]
To: ${lead.executivo_email} (${lead.executivo_nome})
Subject: Inteligência Zion - ${title}
--------------------------------------------------
Olá ${lead.executivo_nome},

O lead "${lead.razao_social}" precisa da sua atenção! 
Já se passaram ${lead.dias_sem_contato} dias desde a sua última interação registrada com a empresa. 

Acesse a Inteligência Zion para marcar um novo contato e avançar essa oportunidade.

Atenciosamente,
Sistema Lead Finder Zion
==================================================
      `)

      processedCount++
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `${processedCount} notificações e e-mails de follow-up enviados com sucesso.`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error: any) {
    console.error('Erro na execução do send-reminders:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
