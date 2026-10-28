// AVOID UPDATING THIS FILE DIRECTLY. It is automatically generated.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      abc_curve_config: {
        Row: {
          a_min: number
          a_plus_min: number
          b_min: number
          c_min: number
          config: Json | null
          id: string
          mode: string
          type: string | null
          updated_at: string
        }
        Insert: {
          a_min?: number
          a_plus_min?: number
          b_min?: number
          c_min?: number
          config?: Json | null
          id?: string
          mode?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          a_min?: number
          a_plus_min?: number
          b_min?: number
          c_min?: number
          config?: Json | null
          id?: string
          mode?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      abc_historico: {
        Row: {
          cliente_cnpj: string
          confirmador_id: string | null
          confirmador_nome: string | null
          curva_anterior: string | null
          curva_nova: string | null
          data: string
          id: string
          mudanca: string | null
        }
        Insert: {
          cliente_cnpj: string
          confirmador_id?: string | null
          confirmador_nome?: string | null
          curva_anterior?: string | null
          curva_nova?: string | null
          data?: string
          id?: string
          mudanca?: string | null
        }
        Update: {
          cliente_cnpj?: string
          confirmador_id?: string | null
          confirmador_nome?: string | null
          curva_anterior?: string | null
          curva_nova?: string | null
          data?: string
          id?: string
          mudanca?: string | null
        }
        Relationships: []
      }
      agenda_disponibilizacoes: {
        Row: {
          agendado: boolean
          agendado_em: string | null
          agendamento_dia: string | null
          agendamento_hora: string | null
          conversation_id: string
          enviado_em: string
          feira_id: string | null
          id: string
          link_enviado: string
          nome_lead: string | null
          profile_id: string
          telefone_lead: string
        }
        Insert: {
          agendado?: boolean
          agendado_em?: string | null
          agendamento_dia?: string | null
          agendamento_hora?: string | null
          conversation_id: string
          enviado_em?: string
          feira_id?: string | null
          id?: string
          link_enviado: string
          nome_lead?: string | null
          profile_id: string
          telefone_lead: string
        }
        Update: {
          agendado?: boolean
          agendado_em?: string | null
          agendamento_dia?: string | null
          agendamento_hora?: string | null
          conversation_id?: string
          enviado_em?: string
          feira_id?: string | null
          id?: string
          link_enviado?: string
          nome_lead?: string | null
          profile_id?: string
          telefone_lead?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agenda_disponibilizacoes_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agenda_disponibilizacoes_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      analise_cnae: {
        Row: {
          cnae: string
          distribuicao_geografica: Json | null
          fit_operacional_score: number | null
          id: string
          nome_cnae: string | null
          taxa_sucesso: number | null
          ticket_medio_cnae: number | null
          total_clientes: number | null
          updated_at: string | null
        }
        Insert: {
          cnae: string
          distribuicao_geografica?: Json | null
          fit_operacional_score?: number | null
          id?: string
          nome_cnae?: string | null
          taxa_sucesso?: number | null
          ticket_medio_cnae?: number | null
          total_clientes?: number | null
          updated_at?: string | null
        }
        Update: {
          cnae?: string
          distribuicao_geografica?: Json | null
          fit_operacional_score?: number | null
          id?: string
          nome_cnae?: string | null
          taxa_sucesso?: number | null
          ticket_medio_cnae?: number | null
          total_clientes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      api_debug_logs: {
        Row: {
          cnae: string | null
          id: string
          limite: number | null
          municipio: string | null
          resposta_json: Json | null
          status_http: number | null
          sucesso: boolean | null
          tempo_resposta_ms: number | null
          timestamp: string
          total_resultados: number | null
          uf: string | null
        }
        Insert: {
          cnae?: string | null
          id?: string
          limite?: number | null
          municipio?: string | null
          resposta_json?: Json | null
          status_http?: number | null
          sucesso?: boolean | null
          tempo_resposta_ms?: number | null
          timestamp?: string
          total_resultados?: number | null
          uf?: string | null
        }
        Update: {
          cnae?: string | null
          id?: string
          limite?: number | null
          municipio?: string | null
          resposta_json?: Json | null
          status_http?: number | null
          sucesso?: boolean | null
          tempo_resposta_ms?: number | null
          timestamp?: string
          total_resultados?: number | null
          uf?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      auditoria_acessos: {
        Row: {
          criado_em: string
          email: string
          pagina: string
          pode_ver: boolean
        }
        Insert: {
          criado_em?: string
          email: string
          pagina: string
          pode_ver?: boolean
        }
        Update: {
          criado_em?: string
          email?: string
          pagina?: string
          pode_ver?: boolean
        }
        Relationships: []
      }
      auditoria_ai_contexts: {
        Row: {
          contexto_custom: string | null
          contexto_padrao: string
          id: number
          modulo: string
          submodulo: string
          updated_at: string
        }
        Insert: {
          contexto_custom?: string | null
          contexto_padrao: string
          id?: number
          modulo: string
          submodulo: string
          updated_at?: string
        }
        Update: {
          contexto_custom?: string | null
          contexto_padrao?: string
          id?: number
          modulo?: string
          submodulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      auditoria_ia_config: {
        Row: {
          ia_geral: boolean
          ia_graficos: boolean
          modulo: string
          updated_at: string
        }
        Insert: {
          ia_geral?: boolean
          ia_graficos?: boolean
          modulo: string
          updated_at?: string
        }
        Update: {
          ia_geral?: boolean
          ia_graficos?: boolean
          modulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      auditoria_page_views: {
        Row: {
          duration_sec: number | null
          id: number
          page: string
          page_label: string | null
          ts: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          duration_sec?: number | null
          id?: number
          page: string
          page_label?: string | null
          ts?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          duration_sec?: number | null
          id?: number
          page?: string
          page_label?: string | null
          ts?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      auditoria_tv_metas: {
        Row: {
          kpi_key: string
          kpi_label: string | null
          meta_hoje: number | null
          meta_mes: number | null
          meta_semana: number | null
          meta_trimestre: number | null
          unidade: string
          updated_at: string
        }
        Insert: {
          kpi_key: string
          kpi_label?: string | null
          meta_hoje?: number | null
          meta_mes?: number | null
          meta_semana?: number | null
          meta_trimestre?: number | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          kpi_key?: string
          kpi_label?: string | null
          meta_hoje?: number | null
          meta_mes?: number | null
          meta_semana?: number | null
          meta_trimestre?: number | null
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      automacao_config: {
        Row: {
          arquivada: boolean | null
          ativo: boolean
          atualizado_em: string
          bitrix_notification_group_id: string | null
          bitrix_pipeline_id: string | null
          bitrix_stage_id: string | null
          cnaes: string[]
          contexto_fup_ia: string | null
          contexto_ia: string | null
          criado_em: string
          criado_por: string | null
          cron_expressao: string | null
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_delay_horas: number | null
          disparo_jitter_seg_max: number | null
          disparo_jitter_seg_min: number | null
          disparo_limite_diario: number | null
          encerrada_em: string | null
          feira_data_fim: string | null
          feira_data_inicio: string | null
          feira_local: string | null
          id: string
          leads_contador: number
          limite_por_execucao: number
          municipios: string[] | null
          nome: string
          numero_feira: number | null
          portes: string[] | null
          roles_pode_disparar: string[] | null
          template_fup: string | null
          template_msg_existente: string | null
          template_msg_novo: string | null
          tipo: string
          tipo_campanha: string
          ufs: string[] | null
          whatsapp_ativo: boolean
          whatsapp_delay_max: number
          whatsapp_delay_min: number
          whatsapp_group_config_id: string | null
          whatsapp_limite_diario: number
          whatsapp_template: string | null
        }
        Insert: {
          arquivada?: boolean | null
          ativo?: boolean
          atualizado_em?: string
          bitrix_notification_group_id?: string | null
          bitrix_pipeline_id?: string | null
          bitrix_stage_id?: string | null
          cnaes?: string[]
          contexto_fup_ia?: string | null
          contexto_ia?: string | null
          criado_em?: string
          criado_por?: string | null
          cron_expressao?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_delay_horas?: number | null
          disparo_jitter_seg_max?: number | null
          disparo_jitter_seg_min?: number | null
          disparo_limite_diario?: number | null
          encerrada_em?: string | null
          feira_data_fim?: string | null
          feira_data_inicio?: string | null
          feira_local?: string | null
          id?: string
          leads_contador?: number
          limite_por_execucao?: number
          municipios?: string[] | null
          nome: string
          numero_feira?: number | null
          portes?: string[] | null
          roles_pode_disparar?: string[] | null
          template_fup?: string | null
          template_msg_existente?: string | null
          template_msg_novo?: string | null
          tipo?: string
          tipo_campanha?: string
          ufs?: string[] | null
          whatsapp_ativo?: boolean
          whatsapp_delay_max?: number
          whatsapp_delay_min?: number
          whatsapp_group_config_id?: string | null
          whatsapp_limite_diario?: number
          whatsapp_template?: string | null
        }
        Update: {
          arquivada?: boolean | null
          ativo?: boolean
          atualizado_em?: string
          bitrix_notification_group_id?: string | null
          bitrix_pipeline_id?: string | null
          bitrix_stage_id?: string | null
          cnaes?: string[]
          contexto_fup_ia?: string | null
          contexto_ia?: string | null
          criado_em?: string
          criado_por?: string | null
          cron_expressao?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_delay_horas?: number | null
          disparo_jitter_seg_max?: number | null
          disparo_jitter_seg_min?: number | null
          disparo_limite_diario?: number | null
          encerrada_em?: string | null
          feira_data_fim?: string | null
          feira_data_inicio?: string | null
          feira_local?: string | null
          id?: string
          leads_contador?: number
          limite_por_execucao?: number
          municipios?: string[] | null
          nome?: string
          numero_feira?: number | null
          portes?: string[] | null
          roles_pode_disparar?: string[] | null
          template_fup?: string | null
          template_msg_existente?: string | null
          template_msg_novo?: string | null
          tipo?: string
          tipo_campanha?: string
          ufs?: string[] | null
          whatsapp_ativo?: boolean
          whatsapp_delay_max?: number
          whatsapp_delay_min?: number
          whatsapp_group_config_id?: string | null
          whatsapp_limite_diario?: number
          whatsapp_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'automacao_config_whatsapp_group_config_id_fkey'
            columns: ['whatsapp_group_config_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_group_config'
            referencedColumns: ['id']
          },
        ]
      }
      avaliacoes: {
        Row: {
          avaliador_id: string | null
          colaborador_id: string
          created_at: string
          id: string
          nota_pontualidade: number
          nota_qualidade: number
          nota_trabalho_equipe: number
          observacoes: string | null
          organization_id: string
          periodo: string
        }
        Insert: {
          avaliador_id?: string | null
          colaborador_id: string
          created_at?: string
          id?: string
          nota_pontualidade: number
          nota_qualidade: number
          nota_trabalho_equipe: number
          observacoes?: string | null
          organization_id: string
          periodo: string
        }
        Update: {
          avaliador_id?: string | null
          colaborador_id?: string
          created_at?: string
          id?: string
          nota_pontualidade?: number
          nota_qualidade?: number
          nota_trabalho_equipe?: number
          observacoes?: string | null
          organization_id?: string
          periodo?: string
        }
        Relationships: [
          {
            foreignKeyName: 'avaliacoes_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_avaliacoes_avaliador'
            columns: ['avaliador_id']
            isOneToOne: false
            referencedRelation: 'colaboradores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_avaliacoes_colaborador'
            columns: ['colaborador_id']
            isOneToOne: false
            referencedRelation: 'colaboradores'
            referencedColumns: ['id']
          },
        ]
      }
      b24_users: {
        Row: {
          id: string
          name: string
          synced_at: string | null
          work_position: string | null
        }
        Insert: {
          id: string
          name: string
          synced_at?: string | null
          work_position?: string | null
        }
        Update: {
          id?: string
          name?: string
          synced_at?: string | null
          work_position?: string | null
        }
        Relationships: []
      }
      bitrix_api_logs: {
        Row: {
          created_at: string | null
          endpoint: string
          error_message: string | null
          id: string
          method: string
          request_body: Json | null
          response_body: Json | null
          response_time_ms: number | null
          status_code: number | null
          timestamp: string
        }
        Insert: {
          created_at?: string | null
          endpoint: string
          error_message?: string | null
          id?: string
          method: string
          request_body?: Json | null
          response_body?: Json | null
          response_time_ms?: number | null
          status_code?: number | null
          timestamp?: string
        }
        Update: {
          created_at?: string | null
          endpoint?: string
          error_message?: string | null
          id?: string
          method?: string
          request_body?: Json | null
          response_body?: Json | null
          response_time_ms?: number | null
          status_code?: number | null
          timestamp?: string
        }
        Relationships: []
      }
      bitrix_clients_zion: {
        Row: {
          bitrix_id: number
          city: string | null
          cnae_principal: string | null
          cnpj: string | null
          company_name: string | null
          created_at: string | null
          curva_abc: string | null
          curva_abc_anterior: string | null
          curva_abc_calculada: string | null
          custo_infra: number | null
          email: string | null
          id: string
          margem_liquida: number | null
          mrr: number | null
          phone: string | null
          porte: string | null
          segmento: string | null
          state: string | null
          synced_at: string | null
          ultima_atualizacao_abc: string | null
        }
        Insert: {
          bitrix_id: number
          city?: string | null
          cnae_principal?: string | null
          cnpj?: string | null
          company_name?: string | null
          created_at?: string | null
          curva_abc?: string | null
          curva_abc_anterior?: string | null
          curva_abc_calculada?: string | null
          custo_infra?: number | null
          email?: string | null
          id?: string
          margem_liquida?: number | null
          mrr?: number | null
          phone?: string | null
          porte?: string | null
          segmento?: string | null
          state?: string | null
          synced_at?: string | null
          ultima_atualizacao_abc?: string | null
        }
        Update: {
          bitrix_id?: number
          city?: string | null
          cnae_principal?: string | null
          cnpj?: string | null
          company_name?: string | null
          created_at?: string | null
          curva_abc?: string | null
          curva_abc_anterior?: string | null
          curva_abc_calculada?: string | null
          custo_infra?: number | null
          email?: string | null
          id?: string
          margem_liquida?: number | null
          mrr?: number | null
          phone?: string | null
          porte?: string | null
          segmento?: string | null
          state?: string | null
          synced_at?: string | null
          ultima_atualizacao_abc?: string | null
        }
        Relationships: []
      }
      bitrix_field_metadata: {
        Row: {
          entity_type: string
          field_name: string
          id: number
          item_id: string
          item_label: string
          kind: string
          updated_at: string
        }
        Insert: {
          entity_type: string
          field_name: string
          id?: number
          item_id: string
          item_label: string
          kind: string
          updated_at?: string
        }
        Update: {
          entity_type?: string
          field_name?: string
          id?: number
          item_id?: string
          item_label?: string
          kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      bitrix_kanbans: {
        Row: {
          bitrix_id: string | null
          category_id: string
          created_at: string | null
          entity_type: string
          id: number
          last_synced_at: string | null
          name: string
          sort: number | null
          status_id: string
          updated_at: string | null
        }
        Insert: {
          bitrix_id?: string | null
          category_id: string
          created_at?: string | null
          entity_type: string
          id?: number
          last_synced_at?: string | null
          name: string
          sort?: number | null
          status_id: string
          updated_at?: string | null
        }
        Update: {
          bitrix_id?: string | null
          category_id?: string
          created_at?: string | null
          entity_type?: string
          id?: number
          last_synced_at?: string | null
          name?: string
          sort?: number | null
          status_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bitrix_rate_limit_config: {
        Row: {
          id: string
          max_requests: number | null
          time_window_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          max_requests?: number | null
          time_window_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          max_requests?: number | null
          time_window_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bitrix_rate_limit_hits: {
        Row: {
          hit_at: string
          id: number
        }
        Insert: {
          hit_at?: string
          id?: number
        }
        Update: {
          hit_at?: string
          id?: number
        }
        Relationships: []
      }
      bitrix_webhook_events: {
        Row: {
          created_at: string | null
          event_type: string | null
          id: string
          payload: Json | null
          processed: boolean | null
          processed_at: string | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          processed_at?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed?: boolean | null
          processed_at?: string | null
        }
        Relationships: []
      }
      cache_pesquisas: {
        Row: {
          chave_cache: string
          criado_em: string
          expira_em: string
          id: string
          parametros: Json | null
          resultados: Json
          total_registros: number
        }
        Insert: {
          chave_cache: string
          criado_em?: string
          expira_em?: string
          id?: string
          parametros?: Json | null
          resultados?: Json
          total_registros?: number
        }
        Update: {
          chave_cache?: string
          criado_em?: string
          expira_em?: string
          id?: string
          parametros?: Json | null
          resultados?: Json
          total_registros?: number
        }
        Relationships: []
      }
      carteira_clientes: {
        Row: {
          cnae: string | null
          cnpj: string | null
          created_at: string | null
          id: string
          porte: string | null
          razao_social: string | null
          segmento: string | null
          uf: string | null
        }
        Insert: {
          cnae?: string | null
          cnpj?: string | null
          created_at?: string | null
          id?: string
          porte?: string | null
          razao_social?: string | null
          segmento?: string | null
          uf?: string | null
        }
        Update: {
          cnae?: string | null
          cnpj?: string | null
          created_at?: string | null
          id?: string
          porte?: string | null
          razao_social?: string | null
          segmento?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      cliente_custo_override: {
        Row: {
          alterado_em: string
          alterado_por_email: string | null
          alterado_por_nome: string | null
          alterado_por_user_id: string | null
          cnpj: string
          created_at: string
          custo_manual: number | null
          id: string
          is_on_premise: boolean
          observacao: string | null
        }
        Insert: {
          alterado_em?: string
          alterado_por_email?: string | null
          alterado_por_nome?: string | null
          alterado_por_user_id?: string | null
          cnpj: string
          created_at?: string
          custo_manual?: number | null
          id?: string
          is_on_premise?: boolean
          observacao?: string | null
        }
        Update: {
          alterado_em?: string
          alterado_por_email?: string | null
          alterado_por_nome?: string | null
          alterado_por_user_id?: string | null
          cnpj?: string
          created_at?: string
          custo_manual?: number | null
          id?: string
          is_on_premise?: boolean
          observacao?: string | null
        }
        Relationships: []
      }
      cliente_custo_override_log: {
        Row: {
          acao: string
          alterado_em: string
          alterado_por_email: string | null
          alterado_por_nome: string | null
          alterado_por_user_id: string | null
          cnpj: string
          custo_manual_antes: number | null
          custo_manual_depois: number | null
          id: string
          is_on_premise_antes: boolean | null
          is_on_premise_depois: boolean | null
          observacao_antes: string | null
          observacao_depois: string | null
        }
        Insert: {
          acao: string
          alterado_em?: string
          alterado_por_email?: string | null
          alterado_por_nome?: string | null
          alterado_por_user_id?: string | null
          cnpj: string
          custo_manual_antes?: number | null
          custo_manual_depois?: number | null
          id?: string
          is_on_premise_antes?: boolean | null
          is_on_premise_depois?: boolean | null
          observacao_antes?: string | null
          observacao_depois?: string | null
        }
        Update: {
          acao?: string
          alterado_em?: string
          alterado_por_email?: string | null
          alterado_por_nome?: string | null
          alterado_por_user_id?: string | null
          cnpj?: string
          custo_manual_antes?: number | null
          custo_manual_depois?: number | null
          id?: string
          is_on_premise_antes?: boolean | null
          is_on_premise_depois?: boolean | null
          observacao_antes?: string | null
          observacao_depois?: string | null
        }
        Relationships: []
      }
      clientes: {
        Row: {
          cnae: string | null
          curva_abc: string | null
          data_criacao: string | null
          id: string
          nome: string
          porte: string | null
          segmento: string | null
          uf: string | null
        }
        Insert: {
          cnae?: string | null
          curva_abc?: string | null
          data_criacao?: string | null
          id?: string
          nome: string
          porte?: string | null
          segmento?: string | null
          uf?: string | null
        }
        Update: {
          cnae?: string | null
          curva_abc?: string | null
          data_criacao?: string | null
          id?: string
          nome?: string
          porte?: string | null
          segmento?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      clusters_estrategicos: {
        Row: {
          cluster_name: string
          cnae_list: string[] | null
          id: string
          oportunidade_score: number | null
          prioridade: string | null
          total_empresas: number | null
          updated_at: string | null
        }
        Insert: {
          cluster_name: string
          cnae_list?: string[] | null
          id?: string
          oportunidade_score?: number | null
          prioridade?: string | null
          total_empresas?: number | null
          updated_at?: string | null
        }
        Update: {
          cluster_name?: string
          cnae_list?: string[] | null
          id?: string
          oportunidade_score?: number | null
          prioridade?: string | null
          total_empresas?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cnae_market_data: {
        Row: {
          a: number | null
          a_plus: number | null
          b: number | null
          c: number | null
          cnae_code: string
          cnae_description: string | null
          data_atualizacao: string | null
          id: string
          nao_classificado: number | null
          potencial_mercado: number | null
          taxa_penetracao: number | null
          tendencia: string | null
          total_clientes: number | null
        }
        Insert: {
          a?: number | null
          a_plus?: number | null
          b?: number | null
          c?: number | null
          cnae_code: string
          cnae_description?: string | null
          data_atualizacao?: string | null
          id?: string
          nao_classificado?: number | null
          potencial_mercado?: number | null
          taxa_penetracao?: number | null
          tendencia?: string | null
          total_clientes?: number | null
        }
        Update: {
          a?: number | null
          a_plus?: number | null
          b?: number | null
          c?: number | null
          cnae_code?: string
          cnae_description?: string | null
          data_atualizacao?: string | null
          id?: string
          nao_classificado?: number | null
          potencial_mercado?: number | null
          taxa_penetracao?: number | null
          tendencia?: string | null
          total_clientes?: number | null
        }
        Relationships: []
      }
      cnae_market_data_potencial: {
        Row: {
          clientes_zion: number | null
          cnae_code: string
          cnae_description: string | null
          created_at: string | null
          data_atualizacao: string | null
          id: string
          potencial_mercado: number | null
          taxa_penetracao: number | null
          tendencia: string | null
        }
        Insert: {
          clientes_zion?: number | null
          cnae_code: string
          cnae_description?: string | null
          created_at?: string | null
          data_atualizacao?: string | null
          id?: string
          potencial_mercado?: number | null
          taxa_penetracao?: number | null
          tendencia?: string | null
        }
        Update: {
          clientes_zion?: number | null
          cnae_code?: string
          cnae_description?: string | null
          created_at?: string | null
          data_atualizacao?: string | null
          id?: string
          potencial_mercado?: number | null
          taxa_penetracao?: number | null
          tendencia?: string | null
        }
        Relationships: []
      }
      cnae_summary: {
        Row: {
          cnae: string
          descricao: string | null
          id: string
          percentual: number | null
          total_clientes: number | null
        }
        Insert: {
          cnae: string
          descricao?: string | null
          id?: string
          percentual?: number | null
          total_clientes?: number | null
        }
        Update: {
          cnae?: string
          descricao?: string | null
          id?: string
          percentual?: number | null
          total_clientes?: number | null
        }
        Relationships: []
      }
      cnae_sync_status: {
        Row: {
          cnaes_from_api: number | null
          cnaes_from_cache: number | null
          cnaes_total: number | null
          id: number
          last_run_at: string | null
          triggered_by: string | null
        }
        Insert: {
          cnaes_from_api?: number | null
          cnaes_from_cache?: number | null
          cnaes_total?: number | null
          id?: number
          last_run_at?: string | null
          triggered_by?: string | null
        }
        Update: {
          cnaes_from_api?: number | null
          cnaes_from_cache?: number | null
          cnaes_total?: number | null
          id?: number
          last_run_at?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      cnpj_divergencias: {
        Row: {
          bitrix_id: number
          cnpj_bitrix: string | null
          cnpj_contaazul: string | null
          company_name: string | null
          contratos: Json | null
          detectado_em: string
          id: string
          mrr: number | null
          nome_contaazul: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: string
        }
        Insert: {
          bitrix_id: number
          cnpj_bitrix?: string | null
          cnpj_contaazul?: string | null
          company_name?: string | null
          contratos?: Json | null
          detectado_em?: string
          id?: string
          mrr?: number | null
          nome_contaazul?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: string
        }
        Update: {
          bitrix_id?: number
          cnpj_bitrix?: string | null
          cnpj_contaazul?: string | null
          company_name?: string | null
          contratos?: Json | null
          detectado_em?: string
          id?: string
          mrr?: number | null
          nome_contaazul?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: string
        }
        Relationships: []
      }
      colaboradores: {
        Row: {
          cargo: string | null
          cpf: string | null
          created_at: string
          data_admissao: string | null
          data_nascimento: string | null
          departamento: string | null
          documentos_urls: Json | null
          email: string | null
          endereco: string | null
          id: string
          image_gender: string | null
          nome: string
          organization_id: string
          rg: string | null
          role: string
          salario: number | null
          status: string | null
          telefone: string | null
          tipo_contrato: string | null
          user_id: string | null
        }
        Insert: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          documentos_urls?: Json | null
          email?: string | null
          endereco?: string | null
          id?: string
          image_gender?: string | null
          nome: string
          organization_id: string
          rg?: string | null
          role?: string
          salario?: number | null
          status?: string | null
          telefone?: string | null
          tipo_contrato?: string | null
          user_id?: string | null
        }
        Update: {
          cargo?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          documentos_urls?: Json | null
          email?: string | null
          endereco?: string | null
          id?: string
          image_gender?: string | null
          nome?: string
          organization_id?: string
          rg?: string | null
          role?: string
          salario?: number | null
          status?: string | null
          telefone?: string | null
          tipo_contrato?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'colaboradores_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      company_duplicates: {
        Row: {
          created_at: string
          duplicate_company_id: number
          id: string
          match_type: Database['public']['Enums']['duplicate_match_type']
          merged_at: string | null
          merged_by: string | null
          notes: string | null
          original_company_id: number
          similarity_score: number | null
          status: Database['public']['Enums']['duplicate_status']
        }
        Insert: {
          created_at?: string
          duplicate_company_id: number
          id?: string
          match_type: Database['public']['Enums']['duplicate_match_type']
          merged_at?: string | null
          merged_by?: string | null
          notes?: string | null
          original_company_id: number
          similarity_score?: number | null
          status?: Database['public']['Enums']['duplicate_status']
        }
        Update: {
          created_at?: string
          duplicate_company_id?: number
          id?: string
          match_type?: Database['public']['Enums']['duplicate_match_type']
          merged_at?: string | null
          merged_by?: string | null
          notes?: string | null
          original_company_id?: number
          similarity_score?: number | null
          status?: Database['public']['Enums']['duplicate_status']
        }
        Relationships: [
          {
            foreignKeyName: 'company_duplicates_duplicate_company_id_fkey'
            columns: ['duplicate_company_id']
            isOneToOne: false
            referencedRelation: 'bitrix_clients_zion'
            referencedColumns: ['bitrix_id']
          },
          {
            foreignKeyName: 'company_duplicates_original_company_id_fkey'
            columns: ['original_company_id']
            isOneToOne: false
            referencedRelation: 'bitrix_clients_zion'
            referencedColumns: ['bitrix_id']
          },
        ]
      }
      company_enriched_cache: {
        Row: {
          cnpj: string
          created_at: string
          data: Json
          expires_at: string
        }
        Insert: {
          cnpj: string
          created_at?: string
          data?: Json
          expires_at?: string
        }
        Update: {
          cnpj?: string
          created_at?: string
          data?: Json
          expires_at?: string
        }
        Relationships: []
      }
      company_merge_history: {
        Row: {
          created_at: string
          fields_updated: Json | null
          id: string
          merged_at: string | null
          merged_by: string | null
          merged_to_company_id: number
          merged_to_company_name: string | null
          original_company_id: number
          original_company_name: string | null
          reason: string | null
          reversible: boolean | null
          reverted_at: string | null
          reverted_by: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          fields_updated?: Json | null
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_to_company_id: number
          merged_to_company_name?: string | null
          original_company_id: number
          original_company_name?: string | null
          reason?: string | null
          reversible?: boolean | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          fields_updated?: Json | null
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_to_company_id?: number
          merged_to_company_name?: string | null
          original_company_id?: number
          original_company_name?: string | null
          reason?: string | null
          reversible?: boolean | null
          reverted_at?: string | null
          reverted_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'company_merge_history_merged_to_company_id_fkey'
            columns: ['merged_to_company_id']
            isOneToOne: false
            referencedRelation: 'bitrix_clients_zion'
            referencedColumns: ['bitrix_id']
          },
        ]
      }
      configuracoes_sistema: {
        Row: {
          casadosdados_api_token: string | null
          contexto_empresa_ia: string | null
          data_ultima_atualizacao_rfb: string | null
          id: number
        }
        Insert: {
          casadosdados_api_token?: string | null
          contexto_empresa_ia?: string | null
          data_ultima_atualizacao_rfb?: string | null
          id?: number
        }
        Update: {
          casadosdados_api_token?: string | null
          contexto_empresa_ia?: string | null
          data_ultima_atualizacao_rfb?: string | null
          id?: number
        }
        Relationships: []
      }
      contaazul_cache: {
        Row: {
          atualizado_em: string
          cnpj: string
          contratos: Json | null
          id: string
          mrr: number
          nome_cliente: string | null
          sincronizado_por: string | null
          sincronizado_por_nome: string | null
        }
        Insert: {
          atualizado_em?: string
          cnpj: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Update: {
          atualizado_em?: string
          cnpj?: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Relationships: []
      }
      contaazul_sync_historico: {
        Row: {
          cnpj: string
          contratos: Json | null
          id: string
          mrr: number
          nome_cliente: string | null
          sincronizado_em: string
          sincronizado_por: string | null
          sincronizado_por_nome: string | null
        }
        Insert: {
          cnpj: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_em?: string
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Update: {
          cnpj?: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_em?: string
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Relationships: []
      }
      contatos_realizados: {
        Row: {
          cnpj: string
          created_at: string | null
          data_contato: string | null
          executivo_id: string | null
          executivo_nome: string | null
          id: string
          status: string | null
        }
        Insert: {
          cnpj: string
          created_at?: string | null
          data_contato?: string | null
          executivo_id?: string | null
          executivo_nome?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          cnpj?: string
          created_at?: string | null
          data_contato?: string | null
          executivo_id?: string | null
          executivo_nome?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'contatos_realizados_executivo_id_fkey'
            columns: ['executivo_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      crm_categories: {
        Row: {
          entity_type_id: string | null
          id: string
          name: string
          synced_at: string | null
        }
        Insert: {
          entity_type_id?: string | null
          id: string
          name: string
          synced_at?: string | null
        }
        Update: {
          entity_type_id?: string | null
          id?: string
          name?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_companies: {
        Row: {
          id: string
          synced_at: string | null
          title: string | null
        }
        Insert: {
          id: string
          synced_at?: string | null
          title?: string | null
        }
        Update: {
          id?: string
          synced_at?: string | null
          title?: string | null
        }
        Relationships: []
      }
      crm_deal_leads: {
        Row: {
          category_id: string | null
          closed: boolean | null
          company_id: string | null
          contact_id: string | null
          deal_id: string
          deal_title: string | null
          lead_id: string
          opportunity: number | null
          source_id: string | null
          stage_id: string | null
          synced_at: string | null
        }
        Insert: {
          category_id?: string | null
          closed?: boolean | null
          company_id?: string | null
          contact_id?: string | null
          deal_id: string
          deal_title?: string | null
          lead_id: string
          opportunity?: number | null
          source_id?: string | null
          stage_id?: string | null
          synced_at?: string | null
        }
        Update: {
          category_id?: string | null
          closed?: boolean | null
          company_id?: string | null
          contact_id?: string | null
          deal_id?: string
          deal_title?: string | null
          lead_id?: string
          opportunity?: number | null
          source_id?: string | null
          stage_id?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_deal_stage_history: {
        Row: {
          deal_id: string
          stage_id: string
        }
        Insert: {
          deal_id: string
          stage_id: string
        }
        Update: {
          deal_id?: string
          stage_id?: string
        }
        Relationships: []
      }
      crm_deal_stage_history_full: {
        Row: {
          created_time: string | null
          deal_id: string
          id: number
          stage_id: string
          synced_at: string | null
        }
        Insert: {
          created_time?: string | null
          deal_id: string
          id?: number
          stage_id: string
          synced_at?: string | null
        }
        Update: {
          created_time?: string | null
          deal_id?: string
          id?: number
          stage_id?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_deal_stages: {
        Row: {
          id: string
          name: string
          semantic: string | null
          sort: number | null
          synced_at: string | null
        }
        Insert: {
          id: string
          name: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_deals: {
        Row: {
          assigned_by_id: string | null
          category_id: string | null
          close_date: string | null
          currency_id: string | null
          date_create: string | null
          id: string
          opportunity: number | null
          stage_id: string | null
          stage_semantic_id: string | null
          synced_at: string | null
          title: string | null
          uf_fields: Json | null
        }
        Insert: {
          assigned_by_id?: string | null
          category_id?: string | null
          close_date?: string | null
          currency_id?: string | null
          date_create?: string | null
          id: string
          opportunity?: number | null
          stage_id?: string | null
          stage_semantic_id?: string | null
          synced_at?: string | null
          title?: string | null
          uf_fields?: Json | null
        }
        Update: {
          assigned_by_id?: string | null
          category_id?: string | null
          close_date?: string | null
          currency_id?: string | null
          date_create?: string | null
          id?: string
          opportunity?: number | null
          stage_id?: string | null
          stage_semantic_id?: string | null
          synced_at?: string | null
          title?: string | null
          uf_fields?: Json | null
        }
        Relationships: []
      }
      crm_lead_sources: {
        Row: {
          id: string
          name: string
          synced_at: string | null
        }
        Insert: {
          id: string
          name: string
          synced_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_lead_statuses: {
        Row: {
          id: string
          name: string
          semantic: string | null
          sort: number | null
          synced_at: string | null
        }
        Insert: {
          id: string
          name: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      crm_leads: {
        Row: {
          assigned_by_id: string | null
          company_id: string | null
          contact_id: string | null
          date_closed: string | null
          date_create: string | null
          date_modify: string | null
          id: string
          name: string | null
          source_id: string | null
          status_id: string | null
          synced_at: string | null
          title: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          assigned_by_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          date_closed?: string | null
          date_create?: string | null
          date_modify?: string | null
          id: string
          name?: string | null
          source_id?: string | null
          status_id?: string | null
          synced_at?: string | null
          title?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          assigned_by_id?: string | null
          company_id?: string | null
          contact_id?: string | null
          date_closed?: string | null
          date_create?: string | null
          date_modify?: string | null
          id?: string
          name?: string | null
          source_id?: string | null
          status_id?: string | null
          synced_at?: string | null
          title?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      crm_stages: {
        Row: {
          entity_id: string | null
          id: string
          name: string
          semantic: string | null
          sort: number | null
          synced_at: string | null
        }
        Insert: {
          entity_id?: string | null
          id: string
          name: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Update: {
          entity_id?: string | null
          id?: string
          name?: string
          semantic?: string | null
          sort?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      dados_capturados_contaazul: {
        Row: {
          capturado_em: string
          documento: string | null
          id: string
          nome: string | null
          pessoa_id: string | null
          raw: Json | null
          tipo: string | null
        }
        Insert: {
          capturado_em?: string
          documento?: string | null
          id?: string
          nome?: string | null
          pessoa_id?: string | null
          raw?: Json | null
          tipo?: string | null
        }
        Update: {
          capturado_em?: string
          documento?: string | null
          id?: string
          nome?: string | null
          pessoa_id?: string | null
          raw?: Json | null
          tipo?: string | null
        }
        Relationships: []
      }
      documentation: {
        Row: {
          description: string
          feature_name: string
          id: string
          module: string
          updated_at: string
          version: number
        }
        Insert: {
          description: string
          feature_name: string
          id?: string
          module: string
          updated_at?: string
          version?: number
        }
        Update: {
          description?: string
          feature_name?: string
          id?: string
          module?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      documentation_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          documentation_id: string
          id: string
          old_description: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          documentation_id: string
          id?: string
          old_description: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          documentation_id?: string
          id?: string
          old_description?: string
        }
        Relationships: [
          {
            foreignKeyName: 'documentation_history_documentation_id_fkey'
            columns: ['documentation_id']
            isOneToOne: false
            referencedRelation: 'documentation'
            referencedColumns: ['id']
          },
        ]
      }
      empresas_rfb: {
        Row: {
          bairro: string | null
          capital_social: number | null
          cep: string | null
          cnae_fiscal_principal: string | null
          cnae_fiscal_secundaria: string | null
          cnaes_secundarios: Json | null
          cnpj: string
          complemento: string | null
          data_abertura: string | null
          data_inicio_atividade: string | null
          email: string | null
          logradouro: string | null
          municipio: string | null
          natureza_juridica: string | null
          nome_fantasia: string | null
          numero: string | null
          porte: string | null
          razao_social: string | null
          situacao_cadastral: string | null
          socios: Json | null
          telefone_1: string | null
          telefone_2: string | null
          tipo_logradouro: string | null
          uf: string | null
        }
        Insert: {
          bairro?: string | null
          capital_social?: number | null
          cep?: string | null
          cnae_fiscal_principal?: string | null
          cnae_fiscal_secundaria?: string | null
          cnaes_secundarios?: Json | null
          cnpj: string
          complemento?: string | null
          data_abertura?: string | null
          data_inicio_atividade?: string | null
          email?: string | null
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          socios?: Json | null
          telefone_1?: string | null
          telefone_2?: string | null
          tipo_logradouro?: string | null
          uf?: string | null
        }
        Update: {
          bairro?: string | null
          capital_social?: number | null
          cep?: string | null
          cnae_fiscal_principal?: string | null
          cnae_fiscal_secundaria?: string | null
          cnaes_secundarios?: Json | null
          cnpj?: string
          complemento?: string | null
          data_abertura?: string | null
          data_inicio_atividade?: string | null
          email?: string | null
          logradouro?: string | null
          municipio?: string | null
          natureza_juridica?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          porte?: string | null
          razao_social?: string | null
          situacao_cadastral?: string | null
          socios?: Json | null
          telefone_1?: string | null
          telefone_2?: string | null
          tipo_logradouro?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      execucoes_automacao: {
        Row: {
          automacao_config_id: string
          erro_mensagem: string | null
          finalizado_em: string | null
          id: string
          iniciado_em: string
          leads_duplicados: number
          leads_encontrados: number
          leads_enviados_bitrix: number
          leads_novos: number
          metadata: Json | null
          status: string
        }
        Insert: {
          automacao_config_id: string
          erro_mensagem?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          leads_duplicados?: number
          leads_encontrados?: number
          leads_enviados_bitrix?: number
          leads_novos?: number
          metadata?: Json | null
          status?: string
        }
        Update: {
          automacao_config_id?: string
          erro_mensagem?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          leads_duplicados?: number
          leads_encontrados?: number
          leads_enviados_bitrix?: number
          leads_novos?: number
          metadata?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'execucoes_automacao_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'execucoes_automacao_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
        ]
      }
      feature_requests: {
        Row: {
          admin_notas: string | null
          criado_em: string
          descricao: string
          id: string
          implementado_em: string | null
          prioridade: string
          revisado_em: string | null
          status: string
          titulo: string
          user_id: string | null
          version_implementada: string | null
        }
        Insert: {
          admin_notas?: string | null
          criado_em?: string
          descricao: string
          id?: string
          implementado_em?: string | null
          prioridade?: string
          revisado_em?: string | null
          status?: string
          titulo: string
          user_id?: string | null
          version_implementada?: string | null
        }
        Update: {
          admin_notas?: string | null
          criado_em?: string
          descricao?: string
          id?: string
          implementado_em?: string | null
          prioridade?: string
          revisado_em?: string | null
          status?: string
          titulo?: string
          user_id?: string | null
          version_implementada?: string | null
        }
        Relationships: []
      }
      feira_disparos_log: {
        Row: {
          agendado_para: string
          automacao_config_id: string
          disparado_em: string
          disparado_por: string
          enviado_em: string | null
          erro_mensagem: string | null
          id: string
          lead_pendente_id: string
          mensagem_final: string
          status: string
          tipo_disparo: string
          whatsapp_message_id: string | null
          whatsapp_phone: string | null
        }
        Insert: {
          agendado_para: string
          automacao_config_id: string
          disparado_em?: string
          disparado_por: string
          enviado_em?: string | null
          erro_mensagem?: string | null
          id?: string
          lead_pendente_id: string
          mensagem_final: string
          status?: string
          tipo_disparo?: string
          whatsapp_message_id?: string | null
          whatsapp_phone?: string | null
        }
        Update: {
          agendado_para?: string
          automacao_config_id?: string
          disparado_em?: string
          disparado_por?: string
          enviado_em?: string | null
          erro_mensagem?: string | null
          id?: string
          lead_pendente_id?: string
          mensagem_final?: string
          status?: string
          tipo_disparo?: string
          whatsapp_message_id?: string | null
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'feira_disparos_log_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'feira_disparos_log_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'feira_disparos_log_lead_pendente_id_fkey'
            columns: ['lead_pendente_id']
            isOneToOne: false
            referencedRelation: 'leads_automacao_pendentes'
            referencedColumns: ['id']
          },
        ]
      }
      ferias: {
        Row: {
          colaborador_id: string | null
          created_at: string
          data_fim: string
          data_inicio: string
          id: string
          observacoes: string | null
          organization_id: string
          status: string | null
        }
        Insert: {
          colaborador_id?: string | null
          created_at?: string
          data_fim: string
          data_inicio: string
          id?: string
          observacoes?: string | null
          organization_id: string
          status?: string | null
        }
        Update: {
          colaborador_id?: string | null
          created_at?: string
          data_fim?: string
          data_inicio?: string
          id?: string
          observacoes?: string | null
          organization_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'ferias_colaborador_id_fkey'
            columns: ['colaborador_id']
            isOneToOne: false
            referencedRelation: 'colaboradores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ferias_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      gads_ad_metrics: {
        Row: {
          account_id: string
          ad_group_id: string
          ad_group_name: string | null
          ad_id: string
          ad_name: string | null
          avg_cpc: number | null
          campaign_id: string
          campaign_name: string | null
          clicks: number | null
          conversions: number | null
          cost_brl: number | null
          ctr: number | null
          impressions: number | null
          report_date: string
          synced_at: string | null
        }
        Insert: {
          account_id: string
          ad_group_id: string
          ad_group_name?: string | null
          ad_id: string
          ad_name?: string | null
          avg_cpc?: number | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          cost_brl?: number | null
          ctr?: number | null
          impressions?: number | null
          report_date: string
          synced_at?: string | null
        }
        Update: {
          account_id?: string
          ad_group_id?: string
          ad_group_name?: string | null
          ad_id?: string
          ad_name?: string | null
          avg_cpc?: number | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          cost_brl?: number | null
          ctr?: number | null
          impressions?: number | null
          report_date?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      gads_alert_config: {
        Row: {
          enabled: boolean | null
          key: string
          label: string
          updated_at: string | null
          value: number | null
        }
        Insert: {
          enabled?: boolean | null
          key: string
          label: string
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          enabled?: boolean | null
          key?: string
          label?: string
          updated_at?: string | null
          value?: number | null
        }
        Relationships: []
      }
      gads_campaign_metrics: {
        Row: {
          account_id: string
          avg_cpc: number | null
          campaign_id: string
          campaign_name: string | null
          clicks: number | null
          conversions: number | null
          cost_brl: number | null
          ctr: number | null
          impressions: number | null
          report_date: string
          synced_at: string | null
        }
        Insert: {
          account_id: string
          avg_cpc?: number | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          cost_brl?: number | null
          ctr?: number | null
          impressions?: number | null
          report_date: string
          synced_at?: string | null
        }
        Update: {
          account_id?: string
          avg_cpc?: number | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number | null
          conversions?: number | null
          cost_brl?: number | null
          ctr?: number | null
          impressions?: number | null
          report_date?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      gads_campaign_overrides: {
        Row: {
          campaign_name_contains: string
          created_at: string | null
          form_id: string | null
          id: number
          label: string
          title_contains: string | null
        }
        Insert: {
          campaign_name_contains: string
          created_at?: string | null
          form_id?: string | null
          id?: number
          label?: string
          title_contains?: string | null
        }
        Update: {
          campaign_name_contains?: string
          created_at?: string | null
          form_id?: string | null
          id?: number
          label?: string
          title_contains?: string | null
        }
        Relationships: []
      }
      gads_campaigns: {
        Row: {
          account_id: string
          account_name: string | null
          channel_type: string | null
          end_date: string | null
          id: string
          name: string | null
          start_date: string | null
          status: string | null
          synced_at: string
        }
        Insert: {
          account_id: string
          account_name?: string | null
          channel_type?: string | null
          end_date?: string | null
          id: string
          name?: string | null
          start_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Update: {
          account_id?: string
          account_name?: string | null
          channel_type?: string | null
          end_date?: string | null
          id?: string
          name?: string | null
          start_date?: string | null
          status?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      gads_fabio_conversations: {
        Row: {
          created_at: string | null
          id: string
          messages: Json
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          messages?: Json
          title?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          messages?: Json
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gads_form_rules: {
        Row: {
          created_at: string | null
          form_id: string
          id: number
          label: string | null
          title_contains: string
        }
        Insert: {
          created_at?: string | null
          form_id: string
          id?: number
          label?: string | null
          title_contains: string
        }
        Update: {
          created_at?: string | null
          form_id?: string
          id?: number
          label?: string | null
          title_contains?: string
        }
        Relationships: []
      }
      integration_health: {
        Row: {
          integracao: string
          motivo: string | null
          status: string
          ultima_notificacao: string | null
          verificado_em: string
        }
        Insert: {
          integracao: string
          motivo?: string | null
          status: string
          ultima_notificacao?: string | null
          verificado_em?: string
        }
        Update: {
          integracao?: string
          motivo?: string | null
          status?: string
          ultima_notificacao?: string | null
          verificado_em?: string
        }
        Relationships: []
      }
      lead_abordagens_comerciais: {
        Row: {
          abordagem_gerada: string | null
          argumentos_venda: string[] | null
          atualizado_em: string | null
          canais_recomendados: string[] | null
          cnae: string | null
          criado_em: string | null
          dores_principais: string | null
          id: string
          lead_id: string | null
          personas_decisoras: string[] | null
          porte_empresa: string | null
          proximos_passos: string[] | null
        }
        Insert: {
          abordagem_gerada?: string | null
          argumentos_venda?: string[] | null
          atualizado_em?: string | null
          canais_recomendados?: string[] | null
          cnae?: string | null
          criado_em?: string | null
          dores_principais?: string | null
          id?: string
          lead_id?: string | null
          personas_decisoras?: string[] | null
          porte_empresa?: string | null
          proximos_passos?: string[] | null
        }
        Update: {
          abordagem_gerada?: string | null
          argumentos_venda?: string[] | null
          atualizado_em?: string | null
          canais_recomendados?: string[] | null
          cnae?: string | null
          criado_em?: string | null
          dores_principais?: string | null
          id?: string
          lead_id?: string | null
          personas_decisoras?: string[] | null
          porte_empresa?: string | null
          proximos_passos?: string[] | null
        }
        Relationships: []
      }
      leads_automacao_pendentes: {
        Row: {
          automacao_config_id: string
          bitrix_lead_id: string | null
          bitrix_match_tipo: string | null
          capturador_nome: string | null
          capturador_phone: string | null
          capturador_user_id: string | null
          cnae_principal: string | null
          cnpj: string | null
          dados_completos: Json | null
          descartado_disparo: boolean | null
          descartado_motivo: string | null
          email: string | null
          encontrado_em: string
          execucao_id: string | null
          id: string
          imagem_path: string | null
          mensagem_disparo_editada: string | null
          mensagem_fup_editada: string | null
          municipio: string | null
          observacao_sdr: string | null
          porte: string | null
          razao_social: string | null
          ref_numero: string | null
          revisado_em: string | null
          revisado_por: string | null
          score_relevancia: number | null
          status: string
          sugestao_abordagem: string | null
          telefone: string | null
          tipo_captura: string | null
          uf: string | null
          whatsapp_enviado_em: string | null
          whatsapp_group_id: string | null
          whatsapp_phone: string | null
          whatsapp_sequence_step: number | null
          whatsapp_status: string | null
        }
        Insert: {
          automacao_config_id: string
          bitrix_lead_id?: string | null
          bitrix_match_tipo?: string | null
          capturador_nome?: string | null
          capturador_phone?: string | null
          capturador_user_id?: string | null
          cnae_principal?: string | null
          cnpj?: string | null
          dados_completos?: Json | null
          descartado_disparo?: boolean | null
          descartado_motivo?: string | null
          email?: string | null
          encontrado_em?: string
          execucao_id?: string | null
          id?: string
          imagem_path?: string | null
          mensagem_disparo_editada?: string | null
          mensagem_fup_editada?: string | null
          municipio?: string | null
          observacao_sdr?: string | null
          porte?: string | null
          razao_social?: string | null
          ref_numero?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          score_relevancia?: number | null
          status?: string
          sugestao_abordagem?: string | null
          telefone?: string | null
          tipo_captura?: string | null
          uf?: string | null
          whatsapp_enviado_em?: string | null
          whatsapp_group_id?: string | null
          whatsapp_phone?: string | null
          whatsapp_sequence_step?: number | null
          whatsapp_status?: string | null
        }
        Update: {
          automacao_config_id?: string
          bitrix_lead_id?: string | null
          bitrix_match_tipo?: string | null
          capturador_nome?: string | null
          capturador_phone?: string | null
          capturador_user_id?: string | null
          cnae_principal?: string | null
          cnpj?: string | null
          dados_completos?: Json | null
          descartado_disparo?: boolean | null
          descartado_motivo?: string | null
          email?: string | null
          encontrado_em?: string
          execucao_id?: string | null
          id?: string
          imagem_path?: string | null
          mensagem_disparo_editada?: string | null
          mensagem_fup_editada?: string | null
          municipio?: string | null
          observacao_sdr?: string | null
          porte?: string | null
          razao_social?: string | null
          ref_numero?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          score_relevancia?: number | null
          status?: string
          sugestao_abordagem?: string | null
          telefone?: string | null
          tipo_captura?: string | null
          uf?: string | null
          whatsapp_enviado_em?: string | null
          whatsapp_group_id?: string | null
          whatsapp_phone?: string | null
          whatsapp_sequence_step?: number | null
          whatsapp_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'leads_automacao_pendentes_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'leads_automacao_pendentes_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'leads_automacao_pendentes_execucao_id_fkey'
            columns: ['execucao_id']
            isOneToOne: false
            referencedRelation: 'execucoes_automacao'
            referencedColumns: ['id']
          },
        ]
      }
      leads_bitrix_sync: {
        Row: {
          company_id: number | null
          contact_action: string | null
          created_at: string | null
          deal_id: number | null
          error_log: string | null
          error_message: string | null
          id: string
          kanban_id: string | null
          lead_action: string | null
          lead_id: string | null
          stage_id: string | null
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: number | null
          contact_action?: string | null
          created_at?: string | null
          deal_id?: number | null
          error_log?: string | null
          error_message?: string | null
          id?: string
          kanban_id?: string | null
          lead_action?: string | null
          lead_id?: string | null
          stage_id?: string | null
          status: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: number | null
          contact_action?: string | null
          created_at?: string | null
          deal_id?: number | null
          error_log?: string | null
          error_message?: string | null
          id?: string
          kanban_id?: string | null
          lead_action?: string | null
          lead_id?: string | null
          stage_id?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'leads_bitrix_sync_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads_salvos'
            referencedColumns: ['id']
          },
        ]
      }
      leads_salvos: {
        Row: {
          bitrix_id: string | null
          capital_social: number | null
          cnae_principal: string | null
          cnpj: string | null
          created_at: string | null
          data_abertura: string | null
          decisor_email: string | null
          decisor_nome: string | null
          decisor_telefone: string | null
          email: string | null
          historico_interacoes: Json | null
          id: string
          municipio: string | null
          observacoes: string | null
          porte: string | null
          razao_social: string | null
          salvo_por: string | null
          situacao: string | null
          socios: Json | null
          status_contato: string | null
          telefone: string | null
          uf: string | null
          ultima_data_contato: string | null
          user_id: string | null
        }
        Insert: {
          bitrix_id?: string | null
          capital_social?: number | null
          cnae_principal?: string | null
          cnpj?: string | null
          created_at?: string | null
          data_abertura?: string | null
          decisor_email?: string | null
          decisor_nome?: string | null
          decisor_telefone?: string | null
          email?: string | null
          historico_interacoes?: Json | null
          id?: string
          municipio?: string | null
          observacoes?: string | null
          porte?: string | null
          razao_social?: string | null
          salvo_por?: string | null
          situacao?: string | null
          socios?: Json | null
          status_contato?: string | null
          telefone?: string | null
          uf?: string | null
          ultima_data_contato?: string | null
          user_id?: string | null
        }
        Update: {
          bitrix_id?: string | null
          capital_social?: number | null
          cnae_principal?: string | null
          cnpj?: string | null
          created_at?: string | null
          data_abertura?: string | null
          decisor_email?: string | null
          decisor_nome?: string | null
          decisor_telefone?: string | null
          email?: string | null
          historico_interacoes?: Json | null
          id?: string
          municipio?: string | null
          observacoes?: string | null
          porte?: string | null
          razao_social?: string | null
          salvo_por?: string | null
          situacao?: string | null
          socios?: Json | null
          status_contato?: string | null
          telefone?: string | null
          uf?: string | null
          ultima_data_contato?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'leads_salvos_salvo_por_fkey'
            columns: ['salvo_por']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      mkt_analytics_metas: {
        Row: {
          id: number
          metas_eventos: Json
          metas_periodo: Json
          metas_trimestre: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          metas_eventos?: Json
          metas_periodo?: Json
          metas_trimestre?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          metas_eventos?: Json
          metas_periodo?: Json
          metas_trimestre?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      mkt_stage_history_checked: {
        Row: {
          checked_at: string
          deal_id: string
          had_history: boolean
        }
        Insert: {
          checked_at?: string
          deal_id: string
          had_history: boolean
        }
        Update: {
          checked_at?: string
          deal_id?: string
          had_history?: boolean
        }
        Relationships: []
      }
      mps_audit_blocos: {
        Row: {
          audit_id: string
          block_key: string
          conformidade: number
          data_auditoria: string | null
          finalized_at: string | null
          id: string
          nc_count: number
          observacoes_gerais: string
          respostas: Json
          status: string
          total: number
          updated_at: string | null
        }
        Insert: {
          audit_id: string
          block_key: string
          conformidade?: number
          data_auditoria?: string | null
          finalized_at?: string | null
          id?: string
          nc_count?: number
          observacoes_gerais?: string
          respostas?: Json
          status?: string
          total?: number
          updated_at?: string | null
        }
        Update: {
          audit_id?: string
          block_key?: string
          conformidade?: number
          data_auditoria?: string | null
          finalized_at?: string | null
          id?: string
          nc_count?: number
          observacoes_gerais?: string
          respostas?: Json
          status?: string
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mps_audit_blocos_audit_id_fkey'
            columns: ['audit_id']
            isOneToOne: false
            referencedRelation: 'mps_audits'
            referencedColumns: ['id']
          },
        ]
      }
      mps_audits: {
        Row: {
          audit_file_path: string | null
          auditor: string
          bitrix_checklist_item_ids: Json
          bitrix_task_id: string | null
          created_at: string | null
          created_by_id: string | null
          created_by_nome: string | null
          estrutura: Json
          grupo: string
          id: string
          kind: string
          projeto_sprint: string
          template_name: string
        }
        Insert: {
          audit_file_path?: string | null
          auditor?: string
          bitrix_checklist_item_ids?: Json
          bitrix_task_id?: string | null
          created_at?: string | null
          created_by_id?: string | null
          created_by_nome?: string | null
          estrutura: Json
          grupo?: string
          id?: string
          kind?: string
          projeto_sprint?: string
          template_name: string
        }
        Update: {
          audit_file_path?: string | null
          auditor?: string
          bitrix_checklist_item_ids?: Json
          bitrix_task_id?: string | null
          created_at?: string | null
          created_by_id?: string | null
          created_by_nome?: string | null
          estrutura?: Json
          grupo?: string
          id?: string
          kind?: string
          projeto_sprint?: string
          template_name?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      nps_apoio_ausencias: {
        Row: {
          client: string
          created_at: string
          created_by: string | null
          id: number
          meeting_date: string
          sheet_config: string
        }
        Insert: {
          client: string
          created_at?: string
          created_by?: string | null
          id?: number
          meeting_date: string
          sheet_config: string
        }
        Update: {
          client?: string
          created_at?: string
          created_by?: string | null
          id?: number
          meeting_date?: string
          sheet_config?: string
        }
        Relationships: []
      }
      nps_responses: {
        Row: {
          client: string
          cs_score: number | null
          id: number
          overall_score: number | null
          raw_fields: Json | null
          reference_date: string | null
          reference_raw: string | null
          sheet_config: string
          source_index: number | null
          support_score: number | null
          synced_at: string | null
        }
        Insert: {
          client: string
          cs_score?: number | null
          id?: number
          overall_score?: number | null
          raw_fields?: Json | null
          reference_date?: string | null
          reference_raw?: string | null
          sheet_config: string
          source_index?: number | null
          support_score?: number | null
          synced_at?: string | null
        }
        Update: {
          client?: string
          cs_score?: number | null
          id?: number
          overall_score?: number | null
          raw_fields?: Json | null
          reference_date?: string | null
          reference_raw?: string | null
          sheet_config?: string
          source_index?: number | null
          support_score?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          created_at: string
          expected_close_date: string | null
          id: string
          lead_id: string
          notes: string | null
          probability: number | null
          stage: Database['public']['Enums']['opportunity_stage']
          updated_at: string
          value: number | null
        }
        Insert: {
          created_at?: string
          expected_close_date?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          probability?: number | null
          stage?: Database['public']['Enums']['opportunity_stage']
          updated_at?: string
          value?: number | null
        }
        Update: {
          created_at?: string
          expected_close_date?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          probability?: number | null
          stage?: Database['public']['Enums']['opportunity_stage']
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'opportunities_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads_salvos'
            referencedColumns: ['id']
          },
        ]
      }
      oracle_cache: {
        Row: {
          atualizado_em: string
          cnpj: string
          contratos: Json | null
          id: string
          mrr: number
          nome_cliente: string | null
          sincronizado_por: string | null
          sincronizado_por_nome: string | null
        }
        Insert: {
          atualizado_em?: string
          cnpj: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Update: {
          atualizado_em?: string
          cnpj?: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Relationships: []
      }
      oracle_cost_config: {
        Row: {
          created_at: string
          custo_mensal: number
          id: string
          porte: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_mensal: number
          id?: string
          porte: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_mensal?: number
          id?: string
          porte?: string
          updated_at?: string
        }
        Relationships: []
      }
      oracle_sync_historico: {
        Row: {
          cnpj: string
          contratos: Json | null
          id: string
          mrr: number
          nome_cliente: string | null
          sincronizado_em: string
          sincronizado_por: string | null
          sincronizado_por_nome: string | null
        }
        Insert: {
          cnpj: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_em?: string
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Update: {
          cnpj?: string
          contratos?: Json | null
          id?: string
          mrr?: number
          nome_cliente?: string | null
          sincronizado_em?: string
          sincronizado_por?: string | null
          sincronizado_por_nome?: string | null
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      perfis_acesso: {
        Row: {
          id: string
          nome: string
          permissoes: Json
        }
        Insert: {
          id?: string
          nome: string
          permissoes?: Json
        }
        Update: {
          id?: string
          nome?: string
          permissoes?: Json
        }
        Relationships: []
      }
      ponto: {
        Row: {
          colaborador_id: string | null
          created_at: string
          data: string
          hora_entrada: string | null
          hora_saida: string | null
          id: string
          organization_id: string
        }
        Insert: {
          colaborador_id?: string | null
          created_at?: string
          data: string
          hora_entrada?: string | null
          hora_saida?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          colaborador_id?: string | null
          created_at?: string
          data?: string
          hora_entrada?: string | null
          hora_saida?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ponto_colaborador_id_fkey'
            columns: ['colaborador_id']
            isOneToOne: false
            referencedRelation: 'colaboradores'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ponto_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          acompanha_agenda: boolean
          ativo: boolean
          bitrix_user_id: string | null
          celular_corporativo: string | null
          email: string
          id: string
          link_agenda: string | null
          nome: string
          participa_agenda: boolean
          perfil_id: string | null
          require_password_update: boolean
          user_id: string | null
        }
        Insert: {
          acompanha_agenda?: boolean
          ativo?: boolean
          bitrix_user_id?: string | null
          celular_corporativo?: string | null
          email: string
          id?: string
          link_agenda?: string | null
          nome: string
          participa_agenda?: boolean
          perfil_id?: string | null
          require_password_update?: boolean
          user_id?: string | null
        }
        Update: {
          acompanha_agenda?: boolean
          ativo?: boolean
          bitrix_user_id?: string | null
          celular_corporativo?: string | null
          email?: string
          id?: string
          link_agenda?: string | null
          nome?: string
          participa_agenda?: boolean
          perfil_id?: string | null
          require_password_update?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_perfil_id_fkey'
            columns: ['perfil_id']
            isOneToOne: false
            referencedRelation: 'perfis_acesso'
            referencedColumns: ['id']
          },
        ]
      }
      recrutamento: {
        Row: {
          created_at: string
          curriculo_url: string | null
          email: string | null
          id: string
          image_gender: string | null
          nome_candidato: string
          organization_id: string
          status: string
          telefone: string | null
          vaga: string
          vaga_id: string | null
        }
        Insert: {
          created_at?: string
          curriculo_url?: string | null
          email?: string | null
          id?: string
          image_gender?: string | null
          nome_candidato: string
          organization_id: string
          status: string
          telefone?: string | null
          vaga: string
          vaga_id?: string | null
        }
        Update: {
          created_at?: string
          curriculo_url?: string | null
          email?: string | null
          id?: string
          image_gender?: string | null
          nome_candidato?: string
          organization_id?: string
          status?: string
          telefone?: string | null
          vaga?: string
          vaga_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'recrutamento_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recrutamento_vaga_id_fkey'
            columns: ['vaga_id']
            isOneToOne: false
            referencedRelation: 'vagas'
            referencedColumns: ['id']
          },
        ]
      }
      reminders: {
        Row: {
          created_at: string
          days_interval: number
          id: string
          is_active: boolean
          last_reminded_at: string | null
          lead_id: string
          reminder_type: Database['public']['Enums']['reminder_type_enum']
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days_interval?: number
          id?: string
          is_active?: boolean
          last_reminded_at?: string | null
          lead_id: string
          reminder_type?: Database['public']['Enums']['reminder_type_enum']
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days_interval?: number
          id?: string
          is_active?: boolean
          last_reminded_at?: string | null
          lead_id?: string
          reminder_type?: Database['public']['Enums']['reminder_type_enum']
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reminders_lead_id_fkey'
            columns: ['lead_id']
            isOneToOne: false
            referencedRelation: 'leads_salvos'
            referencedColumns: ['id']
          },
        ]
      }
      search_history: {
        Row: {
          cidade: string | null
          cnae: string | null
          created_at: string
          estado: string | null
          id: string
          porte: string | null
          total_results: number | null
          user_id: string
        }
        Insert: {
          cidade?: string | null
          cnae?: string | null
          created_at?: string
          estado?: string | null
          id?: string
          porte?: string | null
          total_results?: number | null
          user_id: string
        }
        Update: {
          cidade?: string | null
          cnae?: string | null
          created_at?: string
          estado?: string | null
          id?: string
          porte?: string | null
          total_results?: number | null
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      sprint_elapsed: {
        Row: {
          bitrix_id: string | null
          comment_text: string | null
          created_at: string | null
          created_date: string | null
          date_start: string | null
          date_stop: string | null
          id: number
          seconds: number | null
          source: string | null
          synced_at: string | null
          task_id: string
          user_id: string | null
        }
        Insert: {
          bitrix_id?: string | null
          comment_text?: string | null
          created_at?: string | null
          created_date?: string | null
          date_start?: string | null
          date_stop?: string | null
          id?: number
          seconds?: number | null
          source?: string | null
          synced_at?: string | null
          task_id: string
          user_id?: string | null
        }
        Update: {
          bitrix_id?: string | null
          comment_text?: string | null
          created_at?: string | null
          created_date?: string | null
          date_start?: string | null
          date_stop?: string | null
          id?: number
          seconds?: number | null
          source?: string | null
          synced_at?: string | null
          task_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sprint_groups: {
        Row: {
          id: string
          name: string
          synced_at: string | null
        }
        Insert: {
          id: string
          name: string
          synced_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      sprint_sprints: {
        Row: {
          date_finish: string | null
          date_start: string | null
          elapsed_synced_at: string | null
          group_id: string | null
          id: string
          name: string
          status: string | null
          synced_at: string | null
          tasks_synced_at: string | null
        }
        Insert: {
          date_finish?: string | null
          date_start?: string | null
          elapsed_synced_at?: string | null
          group_id?: string | null
          id: string
          name: string
          status?: string | null
          synced_at?: string | null
          tasks_synced_at?: string | null
        }
        Update: {
          date_finish?: string | null
          date_start?: string | null
          elapsed_synced_at?: string | null
          group_id?: string | null
          id?: string
          name?: string
          status?: string | null
          synced_at?: string | null
          tasks_synced_at?: string | null
        }
        Relationships: []
      }
      sprint_stages: {
        Row: {
          id: string
          name: string
          scope: string
          sort: number | null
          synced_at: string | null
        }
        Insert: {
          id: string
          name: string
          scope: string
          sort?: number | null
          synced_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          scope?: string
          sort?: number | null
          synced_at?: string | null
        }
        Relationships: []
      }
      sprint_task_stage_history: {
        Row: {
          created_date: string
          event_id: string
          stage_from: string | null
          stage_to: string | null
          synced_at: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          created_date: string
          event_id: string
          stage_from?: string | null
          stage_to?: string | null
          synced_at?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          created_date?: string
          event_id?: string
          stage_from?: string | null
          stage_to?: string | null
          synced_at?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sprint_tasks: {
        Row: {
          date_create: string | null
          deadline: string | null
          group_id: string | null
          id: string
          responsible_id: string | null
          responsible_name: string | null
          sprint_id: string | null
          stage_id: string | null
          status: string | null
          synced_at: string | null
          tags: string | null
          time_estimate: number | null
          time_spent_in_logs: number | null
          title: string | null
          uf_fields: Json | null
        }
        Insert: {
          date_create?: string | null
          deadline?: string | null
          group_id?: string | null
          id: string
          responsible_id?: string | null
          responsible_name?: string | null
          sprint_id?: string | null
          stage_id?: string | null
          status?: string | null
          synced_at?: string | null
          tags?: string | null
          time_estimate?: number | null
          time_spent_in_logs?: number | null
          title?: string | null
          uf_fields?: Json | null
        }
        Update: {
          date_create?: string | null
          deadline?: string | null
          group_id?: string | null
          id?: string
          responsible_id?: string | null
          responsible_name?: string | null
          sprint_id?: string | null
          stage_id?: string | null
          status?: string | null
          synced_at?: string | null
          tags?: string | null
          time_estimate?: number | null
          time_spent_in_logs?: number | null
          title?: string | null
          uf_fields?: Json | null
        }
        Relationships: []
      }
      sprint_time_dev_qa: {
        Row: {
          ativo: boolean
          cargo: string
          updated_at: string
          user_id: string
          user_name: string
        }
        Insert: {
          ativo?: boolean
          cargo: string
          updated_at?: string
          user_id: string
          user_name: string
        }
        Update: {
          ativo?: boolean
          cargo?: string
          updated_at?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      sprint_valor_hora_ano: {
        Row: {
          ano: number
          atualizado_em: string | null
          atualizado_por: string | null
          valor_hora: number
        }
        Insert: {
          ano: number
          atualizado_em?: string | null
          atualizado_por?: string | null
          valor_hora: number
        }
        Update: {
          ano?: number
          atualizado_em?: string | null
          atualizado_por?: string | null
          valor_hora?: number
        }
        Relationships: []
      }
      suporte_chamados: {
        Row: {
          category_id: string | null
          category_name: string | null
          creation_date: string | null
          custom_fields_synced: boolean
          customer_email: string | null
          customer_name: string | null
          department_id: string | null
          department_name: string | null
          elapsed_time_sec: number | null
          end_date: string | null
          evaluation_grade: number | null
          evaluation_problem_solved: boolean | null
          first_reply_date: string | null
          id: string
          motivo_abertura: string | null
          operator_name: string | null
          organization_id: string | null
          organization_name: string | null
          priority: number | null
          processo_field: string | null
          protocol: number | null
          sistema_alvo: string | null
          situation_description: string | null
          situation_id: number | null
          sla_deadline_accomplished: boolean | null
          sla_startup_accomplished: boolean | null
          subject: string | null
          synced_at: string
          ticket_type: string | null
          versao_sistema_alvo: string | null
          work_time_sec: number | null
        }
        Insert: {
          category_id?: string | null
          category_name?: string | null
          creation_date?: string | null
          custom_fields_synced?: boolean
          customer_email?: string | null
          customer_name?: string | null
          department_id?: string | null
          department_name?: string | null
          elapsed_time_sec?: number | null
          end_date?: string | null
          evaluation_grade?: number | null
          evaluation_problem_solved?: boolean | null
          first_reply_date?: string | null
          id: string
          motivo_abertura?: string | null
          operator_name?: string | null
          organization_id?: string | null
          organization_name?: string | null
          priority?: number | null
          processo_field?: string | null
          protocol?: number | null
          sistema_alvo?: string | null
          situation_description?: string | null
          situation_id?: number | null
          sla_deadline_accomplished?: boolean | null
          sla_startup_accomplished?: boolean | null
          subject?: string | null
          synced_at?: string
          ticket_type?: string | null
          versao_sistema_alvo?: string | null
          work_time_sec?: number | null
        }
        Update: {
          category_id?: string | null
          category_name?: string | null
          creation_date?: string | null
          custom_fields_synced?: boolean
          customer_email?: string | null
          customer_name?: string | null
          department_id?: string | null
          department_name?: string | null
          elapsed_time_sec?: number | null
          end_date?: string | null
          evaluation_grade?: number | null
          evaluation_problem_solved?: boolean | null
          first_reply_date?: string | null
          id?: string
          motivo_abertura?: string | null
          operator_name?: string | null
          organization_id?: string | null
          organization_name?: string | null
          priority?: number | null
          processo_field?: string | null
          protocol?: number | null
          sistema_alvo?: string | null
          situation_description?: string | null
          situation_id?: number | null
          sla_deadline_accomplished?: boolean | null
          sla_startup_accomplished?: boolean | null
          subject?: string | null
          synced_at?: string
          ticket_type?: string | null
          versao_sistema_alvo?: string | null
          work_time_sec?: number | null
        }
        Relationships: []
      }
      suporte_sync_status: {
        Row: {
          id: number
          last_page: number | null
          last_synced_at: string | null
          total_synced: number | null
        }
        Insert: {
          id?: number
          last_page?: number | null
          last_synced_at?: string | null
          total_synced?: number | null
        }
        Update: {
          id?: number
          last_page?: number | null
          last_synced_at?: string | null
          total_synced?: number | null
        }
        Relationships: []
      }
      suspicious_activity: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string
          resolvido: boolean | null
          severidade: string | null
          timestamp: string | null
          tipo_atividade: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          resolvido?: boolean | null
          severidade?: string | null
          timestamp?: string | null
          tipo_atividade?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          resolvido?: boolean | null
          severidade?: string | null
          timestamp?: string | null
          tipo_atividade?: string | null
          user_id?: string
        }
        Relationships: []
      }
      technical_specs: {
        Row: {
          created_at: string
          description: string | null
          feature_title: string
          id: string
          module: string
          stack: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          feature_title: string
          id?: string
          module: string
          stack?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          feature_title?: string
          id?: string
          module?: string
          stack?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      timeman_entries: {
        Row: {
          date_entry: string | null
          id: number
          seconds: number | null
          sprint_id: string
          synced_at: string | null
          user_id: string
        }
        Insert: {
          date_entry?: string | null
          id?: number
          seconds?: number | null
          sprint_id: string
          synced_at?: string | null
          user_id: string
        }
        Update: {
          date_entry?: string | null
          id?: number
          seconds?: number | null
          sprint_id?: string
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tokens_contaazul: {
        Row: {
          access_token: string | null
          created_at: string
          expires_at: string | null
          id: string
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tokens_google_ads: {
        Row: {
          access_token: string | null
          expires_at: string | null
          id: string
          refresh_token: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          expires_at?: string | null
          id?: string
          refresh_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_reminder_settings: {
        Row: {
          closing_days: number
          created_at: string
          follow_up_days: number
          proposal_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          closing_days?: number
          created_at?: string
          follow_up_days?: number
          proposal_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          closing_days?: number
          created_at?: string
          follow_up_days?: number
          proposal_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string | null
          device_info: Json | null
          duracao_sessao: number | null
          id: string
          ip_address: string | null
          login_time: string | null
          logout_time: string | null
          session_token: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_info?: Json | null
          duracao_sessao?: number | null
          id?: string
          ip_address?: string | null
          login_time?: string | null
          logout_time?: string | null
          session_token?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_info?: Json | null
          duracao_sessao?: number | null
          id?: string
          ip_address?: string | null
          login_time?: string | null
          logout_time?: string | null
          session_token?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vagas: {
        Row: {
          created_at: string
          departamento: string | null
          descricao: string | null
          id: string
          organization_id: string
          requisitos: string | null
          salario: number | null
          status: string | null
          tipo_contrato: string | null
          titulo: string
        }
        Insert: {
          created_at?: string
          departamento?: string | null
          descricao?: string | null
          id?: string
          organization_id: string
          requisitos?: string | null
          salario?: number | null
          status?: string | null
          tipo_contrato?: string | null
          titulo: string
        }
        Update: {
          created_at?: string
          departamento?: string | null
          descricao?: string | null
          id?: string
          organization_id?: string
          requisitos?: string | null
          salario?: number | null
          status?: string | null
          tipo_contrato?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vagas_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_ai_suggestions: {
        Row: {
          acao: string | null
          contexto: string | null
          conversation_id: string
          criado_em: string
          descartada_em: string | null
          id: string
          message_id: string | null
          sugestoes: Json
          texto_usado: string | null
          usada_em: string | null
        }
        Insert: {
          acao?: string | null
          contexto?: string | null
          conversation_id: string
          criado_em?: string
          descartada_em?: string | null
          id?: string
          message_id?: string | null
          sugestoes?: Json
          texto_usado?: string | null
          usada_em?: string | null
        }
        Update: {
          acao?: string | null
          contexto?: string | null
          conversation_id?: string
          criado_em?: string
          descartada_em?: string | null
          id?: string
          message_id?: string | null
          sugestoes?: Json
          texto_usado?: string | null
          usada_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_ai_suggestions_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_ai_suggestions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_messages'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_bitrix_batch: {
        Row: {
          atualizado_em: string
          audio_pendente: boolean
          contador: number
          conversation_id: string
          criado_em: string
          id: string
          message_ids: string[]
          primeiro_evento_em: string
          ultimo_evento_em: string
        }
        Insert: {
          atualizado_em?: string
          audio_pendente?: boolean
          contador?: number
          conversation_id: string
          criado_em?: string
          id?: string
          message_ids?: string[]
          primeiro_evento_em?: string
          ultimo_evento_em?: string
        }
        Update: {
          atualizado_em?: string
          audio_pendente?: boolean
          contador?: number
          conversation_id?: string
          criado_em?: string
          id?: string
          message_ids?: string[]
          primeiro_evento_em?: string
          ultimo_evento_em?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_bitrix_batch_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: true
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_bitrix_candidates: {
        Row: {
          buscado_em: string
          conversation_id: string
          entity_data: Json | null
          entity_id: string
          entity_title: string | null
          entity_type: string
          id: string
        }
        Insert: {
          buscado_em?: string
          conversation_id: string
          entity_data?: Json | null
          entity_id: string
          entity_title?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          buscado_em?: string
          conversation_id?: string
          entity_data?: Json | null
          entity_id?: string
          entity_title?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_bitrix_candidates_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_bitrix_excluded_phones: {
        Row: {
          excluido_em: string
          excluido_por: string | null
          id: string
          motivo: string | null
          phone_key: string
        }
        Insert: {
          excluido_em?: string
          excluido_por?: string | null
          id?: string
          motivo?: string | null
          phone_key: string
        }
        Update: {
          excluido_em?: string
          excluido_por?: string | null
          id?: string
          motivo?: string | null
          phone_key?: string
        }
        Relationships: []
      }
      whatsapp_bitrix_timeline_log: {
        Row: {
          batch_id: string | null
          bitrix_entity_id: string
          bitrix_entity_type: string
          conversation_id: string
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          posted_at: string | null
          status: string
        }
        Insert: {
          batch_id?: string | null
          bitrix_entity_id: string
          bitrix_entity_type: string
          conversation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          posted_at?: string | null
          status: string
        }
        Update: {
          batch_id?: string | null
          bitrix_entity_id?: string
          bitrix_entity_type?: string
          conversation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          posted_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_bitrix_timeline_log_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_bitrix_timeline_log_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_messages'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          agenda_disponibilizacao_id: string | null
          agendamento_dia: string | null
          agendamento_hora: string | null
          automacao_config_id: string | null
          bitrix_entity_id: string | null
          bitrix_entity_type: string | null
          bot_ativo: boolean
          contact_name: string | null
          contexto_enviado_uazapi: boolean | null
          criado_em: string
          estado: string
          id: string
          instance_id: string
          lead_score: number | null
          phone: string
          ultimo_contato: string
        }
        Insert: {
          agenda_disponibilizacao_id?: string | null
          agendamento_dia?: string | null
          agendamento_hora?: string | null
          automacao_config_id?: string | null
          bitrix_entity_id?: string | null
          bitrix_entity_type?: string | null
          bot_ativo?: boolean
          contact_name?: string | null
          contexto_enviado_uazapi?: boolean | null
          criado_em?: string
          estado?: string
          id?: string
          instance_id: string
          lead_score?: number | null
          phone: string
          ultimo_contato?: string
        }
        Update: {
          agenda_disponibilizacao_id?: string | null
          agendamento_dia?: string | null
          agendamento_hora?: string | null
          automacao_config_id?: string | null
          bitrix_entity_id?: string | null
          bitrix_entity_type?: string | null
          bot_ativo?: boolean
          contact_name?: string | null
          contexto_enviado_uazapi?: boolean | null
          criado_em?: string
          estado?: string
          id?: string
          instance_id?: string
          lead_score?: number | null
          phone?: string
          ultimo_contato?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_conversations_agenda_disponibilizacao_id_fkey'
            columns: ['agenda_disponibilizacao_id']
            isOneToOne: false
            referencedRelation: 'agenda_disponibilizacoes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_conversations_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_conversations_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_conversations_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'vw_executivos_copiloto'
            referencedColumns: ['instance_id']
          },
          {
            foreignKeyName: 'whatsapp_conversations_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_instances'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_deal_summaries: {
        Row: {
          conversation_id: string
          deal_id: number
          generated_at: string
          generated_by: string | null
          id: string
          model: string | null
          summary: string
          tokens_used: number | null
        }
        Insert: {
          conversation_id: string
          deal_id: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          summary: string
          tokens_used?: number | null
        }
        Update: {
          conversation_id?: string
          deal_id?: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          model?: string | null
          summary?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_deal_summaries_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_group_config: {
        Row: {
          ativo: boolean
          atualizado_em: string
          automacao_config_id: string | null
          criado_em: string
          descricao: string | null
          group_id: string
          id: string
          instance_id: string | null
          nome: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          automacao_config_id?: string | null
          criado_em?: string
          descricao?: string | null
          group_id: string
          id?: string
          instance_id?: string | null
          nome: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          automacao_config_id?: string | null
          criado_em?: string
          descricao?: string | null
          group_id?: string
          id?: string
          instance_id?: string | null
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_group_config_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_group_config_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_group_config_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'vw_executivos_copiloto'
            referencedColumns: ['instance_id']
          },
          {
            foreignKeyName: 'whatsapp_group_config_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_instances'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_group_messages: {
        Row: {
          apagado_em: string | null
          apagado_modo: string | null
          conteudo: string | null
          criado_em: string
          direcao: string
          editado_em: string | null
          group_id: string
          id: string
          media_mimetype: string | null
          media_storage_path: string | null
          media_url: string | null
          message_id: string
          sender_jid: string | null
          sender_name: string | null
          texto_original: string | null
          tipo: string
        }
        Insert: {
          apagado_em?: string | null
          apagado_modo?: string | null
          conteudo?: string | null
          criado_em?: string
          direcao: string
          editado_em?: string | null
          group_id: string
          id?: string
          media_mimetype?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_id: string
          sender_jid?: string | null
          sender_name?: string | null
          texto_original?: string | null
          tipo: string
        }
        Update: {
          apagado_em?: string | null
          apagado_modo?: string | null
          conteudo?: string | null
          criado_em?: string
          direcao?: string
          editado_em?: string | null
          group_id?: string
          id?: string
          media_mimetype?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_id?: string
          sender_jid?: string | null
          sender_name?: string | null
          texto_original?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_group_messages_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_groups'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          atualizado_em: string
          criado_em: string
          group_jid: string
          id: string
          instance_id: string
          nome: string | null
          silenciado: boolean
          ultima_mensagem: string | null
          ultimo_contato: string | null
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          group_jid: string
          id?: string
          instance_id: string
          nome?: string | null
          silenciado?: boolean
          ultima_mensagem?: string | null
          ultimo_contato?: string | null
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          group_jid?: string
          id?: string
          instance_id?: string
          nome?: string | null
          silenciado?: boolean
          ultima_mensagem?: string | null
          ultimo_contato?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_groups_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'vw_executivos_copiloto'
            referencedColumns: ['instance_id']
          },
          {
            foreignKeyName: 'whatsapp_groups_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_instances'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          ativo: boolean
          atualizado_em: string
          bitrix_user_id: string | null
          bitrix_user_nome: string | null
          criado_em: string
          id: string
          instance_key: string
          instance_token: string | null
          last_disconnect_notified: string | null
          nome: string
          numero: string
          profile_user_id: string | null
          status: string
          tipo: string
          ultimo_ping: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          bitrix_user_id?: string | null
          bitrix_user_nome?: string | null
          criado_em?: string
          id?: string
          instance_key?: string
          instance_token?: string | null
          last_disconnect_notified?: string | null
          nome: string
          numero?: string
          profile_user_id?: string | null
          status?: string
          tipo?: string
          ultimo_ping?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          bitrix_user_id?: string | null
          bitrix_user_nome?: string | null
          criado_em?: string
          id?: string
          instance_key?: string
          instance_token?: string | null
          last_disconnect_notified?: string | null
          nome?: string
          numero?: string
          profile_user_id?: string | null
          status?: string
          tipo?: string
          ultimo_ping?: string | null
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          apagado_em: string | null
          apagado_modo: string | null
          audio_duration_seconds: number | null
          caption: string | null
          conteudo: string | null
          conversation_id: string
          criado_em: string
          direcao: string
          editado_em: string | null
          id: string
          last_retry_at: string | null
          media_ai_description: string | null
          media_mimetype: string | null
          media_storage_path: string | null
          media_transcription: string | null
          media_url: string | null
          message_id: string
          metadata: Json | null
          processado: boolean
          quoted_message_id: string | null
          retry_count: number
          texto_original: string | null
          tipo: string
          transcription_failed_at: string | null
        }
        Insert: {
          apagado_em?: string | null
          apagado_modo?: string | null
          audio_duration_seconds?: number | null
          caption?: string | null
          conteudo?: string | null
          conversation_id: string
          criado_em?: string
          direcao: string
          editado_em?: string | null
          id?: string
          last_retry_at?: string | null
          media_ai_description?: string | null
          media_mimetype?: string | null
          media_storage_path?: string | null
          media_transcription?: string | null
          media_url?: string | null
          message_id: string
          metadata?: Json | null
          processado?: boolean
          quoted_message_id?: string | null
          retry_count?: number
          texto_original?: string | null
          tipo?: string
          transcription_failed_at?: string | null
        }
        Update: {
          apagado_em?: string | null
          apagado_modo?: string | null
          audio_duration_seconds?: number | null
          caption?: string | null
          conteudo?: string | null
          conversation_id?: string
          criado_em?: string
          direcao?: string
          editado_em?: string | null
          id?: string
          last_retry_at?: string | null
          media_ai_description?: string | null
          media_mimetype?: string | null
          media_storage_path?: string | null
          media_transcription?: string | null
          media_url?: string | null
          message_id?: string
          metadata?: Json | null
          processado?: boolean
          quoted_message_id?: string | null
          retry_count?: number
          texto_original?: string | null
          tipo?: string
          transcription_failed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_conversations'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_module_config: {
        Row: {
          atualizado_em: string
          bot_pausado_globalmente: boolean
          chatbot_stop_keyword: string | null
          chatbot_stop_minutes: number | null
          criado_em: string
          dias_semana: number[]
          horario_fim: string
          horario_inicio: string
          id: number
          is_connected: boolean | null
          last_check_at: string | null
          last_check_error: string | null
          prompt_base: string
          responsavel_bitrix_id: string
          responsavel_nome: string
          uazapi_base_url: string
          uazapi_global_token: string
        }
        Insert: {
          atualizado_em?: string
          bot_pausado_globalmente?: boolean
          chatbot_stop_keyword?: string | null
          chatbot_stop_minutes?: number | null
          criado_em?: string
          dias_semana?: number[]
          horario_fim?: string
          horario_inicio?: string
          id?: number
          is_connected?: boolean | null
          last_check_at?: string | null
          last_check_error?: string | null
          prompt_base?: string
          responsavel_bitrix_id?: string
          responsavel_nome?: string
          uazapi_base_url?: string
          uazapi_global_token?: string
        }
        Update: {
          atualizado_em?: string
          bot_pausado_globalmente?: boolean
          chatbot_stop_keyword?: string | null
          chatbot_stop_minutes?: number | null
          criado_em?: string
          dias_semana?: number[]
          horario_fim?: string
          horario_inicio?: string
          id?: number
          is_connected?: boolean | null
          last_check_at?: string | null
          last_check_error?: string | null
          prompt_base?: string
          responsavel_bitrix_id?: string
          responsavel_nome?: string
          uazapi_base_url?: string
          uazapi_global_token?: string
        }
        Relationships: []
      }
      whatsapp_send_queue: {
        Row: {
          agendado_para: string | null
          atualizado_em: string
          automacao_config_id: string | null
          bitrix_lead_id: string | null
          cancelado_em: string | null
          cancelado_por: string | null
          contact_name: string | null
          criado_em: string
          editado_em: string | null
          editado_por: string | null
          enviado_em: string | null
          erro_mensagem: string | null
          id: string
          instance_id: string | null
          lead_cnpj: string | null
          max_tentativas: number
          mensagem: string
          mensagem_original: string | null
          message_type: string | null
          numero_verificado: boolean | null
          phone: string
          sequence_step: number | null
          status: string
          tentativas: number
        }
        Insert: {
          agendado_para?: string | null
          atualizado_em?: string
          automacao_config_id?: string | null
          bitrix_lead_id?: string | null
          cancelado_em?: string | null
          cancelado_por?: string | null
          contact_name?: string | null
          criado_em?: string
          editado_em?: string | null
          editado_por?: string | null
          enviado_em?: string | null
          erro_mensagem?: string | null
          id?: string
          instance_id?: string | null
          lead_cnpj?: string | null
          max_tentativas?: number
          mensagem: string
          mensagem_original?: string | null
          message_type?: string | null
          numero_verificado?: boolean | null
          phone: string
          sequence_step?: number | null
          status?: string
          tentativas?: number
        }
        Update: {
          agendado_para?: string | null
          atualizado_em?: string
          automacao_config_id?: string | null
          bitrix_lead_id?: string | null
          cancelado_em?: string | null
          cancelado_por?: string | null
          contact_name?: string | null
          criado_em?: string
          editado_em?: string | null
          editado_por?: string | null
          enviado_em?: string | null
          erro_mensagem?: string | null
          id?: string
          instance_id?: string | null
          lead_cnpj?: string | null
          max_tentativas?: number
          mensagem?: string
          mensagem_original?: string | null
          message_type?: string | null
          numero_verificado?: boolean | null
          phone?: string
          sequence_step?: number | null
          status?: string
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_send_queue_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'automacao_config'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_send_queue_automacao_config_id_fkey'
            columns: ['automacao_config_id']
            isOneToOne: false
            referencedRelation: 'vw_feiras_com_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whatsapp_send_queue_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'vw_executivos_copiloto'
            referencedColumns: ['instance_id']
          },
          {
            foreignKeyName: 'whatsapp_send_queue_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_instances'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_silenced_phones: {
        Row: {
          criado_em: string
          criado_por: string | null
          id: string
          instance_id: string
          is_group: boolean
          motivo: string | null
          phone: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          instance_id: string
          is_group?: boolean
          motivo?: string | null
          phone: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          instance_id?: string
          is_group?: boolean
          motivo?: string | null
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_silenced_phones_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'vw_executivos_copiloto'
            referencedColumns: ['instance_id']
          },
          {
            foreignKeyName: 'whatsapp_silenced_phones_instance_id_fkey'
            columns: ['instance_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_instances'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      vw_executivos_copiloto: {
        Row: {
          bitrix_user_nome: string | null
          conversas_24h: number | null
          conversas_count: number | null
          email: string | null
          executivo_nome: string | null
          instance_id: string | null
          instance_key: string | null
          instance_status: string | null
          perfil_nome: string | null
          user_id: string | null
        }
        Relationships: []
      }
      vw_feiras_com_status: {
        Row: {
          arquivada: boolean | null
          ativo: boolean | null
          atualizado_em: string | null
          bitrix_notification_group_id: string | null
          bitrix_pipeline_id: string | null
          bitrix_stage_id: string | null
          cnaes: string[] | null
          contexto_fup_ia: string | null
          contexto_ia: string | null
          criado_em: string | null
          criado_por: string | null
          cron_expressao: string | null
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_delay_horas: number | null
          disparo_jitter_seg_max: number | null
          disparo_jitter_seg_min: number | null
          disparo_limite_diario: number | null
          disparos_agendados_count: number | null
          disparos_enviados_count: number | null
          encerrada_em: string | null
          feira_data_fim: string | null
          feira_data_inicio: string | null
          feira_local: string | null
          id: string | null
          leads_capturados_count: number | null
          leads_contador: number | null
          leads_empresas_count: number | null
          leads_incompletos_count: number | null
          leads_quentes_count: number | null
          limite_por_execucao: number | null
          municipios: string[] | null
          nome: string | null
          numero_feira: number | null
          portes: string[] | null
          roles_pode_disparar: string[] | null
          status_calculado: string | null
          template_fup: string | null
          template_msg_existente: string | null
          template_msg_novo: string | null
          tipo: string | null
          tipo_campanha: string | null
          ufs: string[] | null
          whatsapp_ativo: boolean | null
          whatsapp_delay_max: number | null
          whatsapp_delay_min: number | null
          whatsapp_group_ativo: boolean | null
          whatsapp_group_config_id: string | null
          whatsapp_group_id: string | null
          whatsapp_group_nome: string | null
          whatsapp_limite_diario: number | null
          whatsapp_template: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'automacao_config_whatsapp_group_config_id_fkey'
            columns: ['whatsapp_group_config_id']
            isOneToOne: false
            referencedRelation: 'whatsapp_group_config'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      auditoria_cs_conversion: {
        Args: {
          p_category_id?: string
          p_date_from?: string
          p_date_to?: string
        }
        Returns: Json
      }
      auditoria_cs_deals: {
        Args: {
          p_category_id?: string
          p_date_from?: string
          p_date_to?: string
          p_exclude_nutri?: boolean
          p_status?: string
        }
        Returns: Json
      }
      auditoria_cs_quarterly_revenue: {
        Args: { p_category_id?: string; p_year: string }
        Returns: Json
      }
      auditoria_cs_won_summary: {
        Args: {
          p_category_id?: string
          p_date_from?: string
          p_date_to?: string
        }
        Returns: Json
      }
      auditoria_funil_alert_deals: {
        Args: { p_lead_ids: string[] }
        Returns: Json
      }
      auditoria_funil_detail: {
        Args: { p_end: string; p_start: string; p_type: string }
        Returns: Json
      }
      auditoria_funil_leads_periodo: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      auditoria_funil_opp_active: { Args: never; Returns: Json }
      auditoria_funil_opp_deals: {
        Args: { p_lead_ids: string[] }
        Returns: Json
      }
      auditoria_funil_opp_stuck: { Args: never; Returns: Json }
      auditoria_funil_velocity: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      auditoria_funil_won_deals: {
        Args: { p_lead_ids: string[] }
        Returns: Json
      }
      auditoria_gads_ads_list: {
        Args: { p_campaign_ids?: string[]; p_campaign_status?: string }
        Returns: {
          ad_group_name: string
          ad_id: string
          ad_name: string
          campaign_id: string
          campaign_name: string
        }[]
      }
      auditoria_gads_campaign_leads: {
        Args: {
          p_campaign_status?: string
          p_date_from: string
          p_date_to: string
        }
        Returns: {
          ad_group_name: string
          campaign_id: string
          campaign_name: string
          converted: number
          cpl: number
          discarded: number
          form_id: string
          form_name: string
          mql: number
          opp: number
          sql: number
          total_cost: number
          total_leads: number
          won: number
        }[]
      }
      auditoria_gads_campaigns_list: {
        Args: { p_status?: string }
        Returns: {
          campaign_id: string
          campaign_name: string
        }[]
      }
      auditoria_gads_summary: {
        Args: {
          p_ad_ids?: string[]
          p_campaign_ids?: string[]
          p_campaign_status?: string
          p_date_from: string
          p_date_to: string
        }
        Returns: Json
      }
      auditoria_horas_previstas_dados: {
        Args: { p_group_id: string; p_sprint_id: string }
        Returns: Json
      }
      auditoria_mkt_analytics_analyze: {
        Args: { p_date_from: string; p_date_to: string; p_stage_id?: string }
        Returns: Json
      }
      auditoria_mkt_analytics_funil_fonte: {
        Args: { p_source_id?: string; p_year: number }
        Returns: Json
      }
      auditoria_mkt_analytics_funil_fonte_detail: {
        Args: {
          p_fonte_name?: string
          p_mes?: string
          p_source_id?: string
          p_type: string
          p_year: number
        }
        Returns: Json
      }
      auditoria_mkt_analytics_won_periodo: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: Json
      }
      auditoria_mkt_deals: { Args: { p_lead_ids: string[] }; Returns: Json }
      auditoria_mkt_deals_desatualizados: {
        Args: { p_limit?: number }
        Returns: Json
      }
      auditoria_mkt_funil_prospeccao_prefixes: {
        Args: never
        Returns: string[]
      }
      auditoria_mkt_leads: {
        Args: {
          p_assigned_by_id?: string
          p_date_from?: string
          p_date_to?: string
          p_status_id?: string
        }
        Returns: Json
      }
      auditoria_mkt_leads_closed: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      auditoria_mkt_leads_sem_vinculo: {
        Args: { p_excluidos?: string[]; p_limit?: number }
        Returns: Json
      }
      auditoria_mkt_leads_teste: { Args: never; Returns: Json }
      auditoria_mkt_leads_today: { Args: never; Returns: Json }
      auditoria_mkt_velocity_raw: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: Json
      }
      auditoria_nc_aging: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_data: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_escalonamento_por_grupo: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      auditoria_nc_escalonamento_por_responsavel: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_group: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      auditoria_nc_group_pattern: { Args: { p_group: string }; Returns: string }
      auditoria_nc_por_grupo: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      auditoria_nc_responsaveis: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_status_abertos: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_tasks: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_group?: string
          p_open_only?: boolean
          p_responsible?: string
          p_stage_id?: string
        }
        Returns: Json
      }
      auditoria_nc_tendencia: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nc_velocidade: {
        Args: { p_date_from?: string; p_date_to?: string; p_group?: string }
        Returns: Json
      }
      auditoria_nps_configs: { Args: never; Returns: Json }
      auditoria_ociosidade_periodo: {
        Args: { p_date_from: string; p_date_to: string; p_group_ids?: string[] }
        Returns: Json
      }
      auditoria_page_view_stats: {
        Args: { p_period: string; p_user_id?: string }
        Returns: Json
      }
      auditoria_sprint_chamados: {
        Args: { p_date_from?: string; p_date_to?: string; p_group_id: string }
        Returns: Json
      }
      auditoria_sprint_elapsed: {
        Args: { p_group_id: string; p_sprint_id?: string }
        Returns: Json
      }
      auditoria_sprint_horas_manuais: {
        Args: { p_group_ids: string[] }
        Returns: Json
      }
      auditoria_sprint_ociosidade: {
        Args: {
          p_ano?: number
          p_excluir_sem_apontamento?: boolean
          p_group_ids: string[]
        }
        Returns: Json
      }
      auditoria_sprint_paineis_dev_qa: { Args: never; Returns: Json }
      auditoria_sprint_sprints: { Args: { p_group_id: string }; Returns: Json }
      auditoria_sprint_task_logs: {
        Args: { p_task_ids: string[] }
        Returns: Json
      }
      auditoria_sprint_task_voltas: {
        Args: { p_task_ids: string[] }
        Returns: Json
      }
      auditoria_sprint_tasks: {
        Args: { p_group_id: string; p_sprint_id?: string }
        Returns: Json
      }
      auditoria_sprint_timeman: { Args: { p_sprint_id: string }; Returns: Json }
      auditoria_suporte_analytics: {
        Args: { p_date_end?: string; p_date_start?: string }
        Returns: Json
      }
      auditoria_suporte_chamados_por_filtro: {
        Args: {
          p_date_end?: string
          p_date_start?: string
          p_dimensao?: string
          p_valor?: string
        }
        Returns: Json
      }
      auditoria_suporte_data: {
        Args: {
          p_categorias?: string[]
          p_date_end?: string
          p_date_start?: string
          p_motivos?: string[]
        }
        Returns: Json
      }
      auditoria_suporte_qualidade: {
        Args: { p_date_end?: string; p_date_start?: string }
        Returns: Json
      }
      auditoria_suporte_resolucao: {
        Args: { p_date_end?: string; p_date_start?: string }
        Returns: Json
      }
      auditoria_suporte_tempos: {
        Args: { p_date_end?: string; p_date_start?: string }
        Returns: Json
      }
      auditoria_tv_kpi_json: {
        Args: {
          p_default_unidade?: string
          p_kpi_key: string
          p_meta_field: string
          p_metas: Json
          p_prev: number
          p_value: number
        }
        Returns: Json
      }
      auditoria_tv_kpis: { Args: { p_period: string }; Returns: Json }
      auditoria_tv_mkt_fontes: { Args: never; Returns: Json }
      auditoria_tv_mkt_sql_stages: { Args: never; Returns: Json }
      auditoria_tv_mkt_summary: { Args: never; Returns: Json }
      auditoria_tv_sparklines: { Args: { p_period: string }; Returns: Json }
      auditoria_utm_summary: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      bitrix_try_acquire: { Args: never; Returns: Json }
      business_hours_diff: {
        Args: { ts_end: string; ts_start: string }
        Returns: number
      }
      clear_own_require_password_update: { Args: never; Returns: undefined }
      current_user_has_permission: {
        Args: { p_perm: string }
        Returns: boolean
      }
      current_user_role: { Args: never; Returns: string }
      dearmor: { Args: { '': string }; Returns: string }
      feira_calcular_status: { Args: { p_feira_id: string }; Returns: string }
      find_potential_duplicates: {
        Args: { min_score?: number }
        Returns: {
          empresa1_id: number
          empresa2_id: number
          similarity_score: number
          tipo_similaridade: string
        }[]
      }
      flush_batches_inativos: { Args: never; Returns: undefined }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { '': string }; Returns: string }
      get_consultant_role_ids: {
        Args: { p_user_id: string }
        Returns: number[]
      }
      get_due_followups: {
        Args: never
        Returns: {
          dias_sem_contato: number
          executivo_email: string
          executivo_nome: string
          lead_id: string
          opp_stage: string
          razao_social: string
          reminder_type: string
          user_id: string
        }[]
      }
      get_due_reminders_with_leads: {
        Args: never
        Returns: {
          days_interval: number
          executivo_email: string
          executivo_nome: string
          lead_id: string
          razao_social: string
          reminder_id: string
          reminder_type: Database['public']['Enums']['reminder_type_enum']
          user_id: string
        }[]
      }
      get_my_org_id: { Args: never; Returns: string }
      limpar_cache_pesquisas: { Args: { p_cnae?: string }; Returns: number }
      list_commission_roles: {
        Args: never
        Returns: {
          code: string
          id: number
          name: string
        }[]
      }
      mkt_stage_history_pending: { Args: { p_limit?: number }; Returns: Json }
      pgp_armor_headers: {
        Args: { '': string }
        Returns: Record<string, unknown>[]
      }
      promote_whatsapp_instance_to_principal: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      proximo_ref_lead: { Args: { p_feira_id: string }; Returns: string }
      run_automacao_campaign: {
        Args: { p_config_id: string }
        Returns: undefined
      }
      run_gads_sync: { Args: never; Returns: undefined }
      run_integrations_health_check: { Args: never; Returns: undefined }
      run_sprint_sync_daily: { Args: never; Returns: undefined }
      run_tomticket_sync_hourly: { Args: never; Returns: undefined }
      run_whatsapp_health_check: { Args: never; Returns: undefined }
      run_whatsapp_queue_leads: { Args: never; Returns: undefined }
      run_whatsapp_retry_unprocessed: { Args: never; Returns: undefined }
      run_whatsapp_send_scheduler: { Args: never; Returns: undefined }
      schedule_automacao_campaign: {
        Args: { p_config_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { '': string }; Returns: string[] }
      sprint_apontamento_manual: {
        Args: {
          p_date_start: string
          p_date_stop: string
          p_seconds: number
          p_source: string
        }
        Returns: boolean
      }
      sprint_apontamentos_marcados: {
        Args: { p_task_ids: string[] }
        Returns: {
          assumiu: boolean
          cargo: string
          comentario: string
          created_at: string
          created_date: string
          date_start: string
          date_stop: string
          eh_dev: boolean
          manual: boolean
          ordem: number
          retomada: boolean
          seconds: number
          source: string
          task_id: string
          user_id: string
          user_name: string
          work_position: string
        }[]
      }
      sprint_stage_area: { Args: { p_nome: string }; Returns: string }
      sync_all_automacao_cron_jobs: { Args: never; Returns: number }
      sync_commission_consultant: {
        Args: { p_role_ids: number[]; p_user_id: string }
        Returns: number
      }
      unschedule_automacao_campaign: {
        Args: { p_config_id: string }
        Returns: undefined
      }
      user_can_observe_all: { Args: never; Returns: boolean }
    }
    Enums: {
      duplicate_match_type:
        | 'cnpj_exact'
        | 'razao_social_single'
        | 'razao_social_multiple'
      duplicate_status: 'pending_review' | 'merged' | 'ignored'
      opportunity_stage:
        | 'prospecting'
        | 'qualification'
        | 'proposal'
        | 'closing'
      reminder_type_enum: 'follow_up' | 'proposal' | 'closing'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      duplicate_match_type: [
        'cnpj_exact',
        'razao_social_single',
        'razao_social_multiple',
      ],
      duplicate_status: ['pending_review', 'merged', 'ignored'],
      opportunity_stage: [
        'prospecting',
        'qualification',
        'proposal',
        'closing',
      ],
      reminder_type_enum: ['follow_up', 'proposal', 'closing'],
    },
  },
} as const
