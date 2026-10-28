// Campos padrão + UF_CRM_* relevantes para cada entity_type.
// Lista decidida em revisão de schema (10/maio/2026).
// Para adicionar/remover campos, edite SOMENTE este arquivo.

export type EntityType = 'contact' | 'lead' | 'company' | 'deal'

export interface FieldDef {
  key: string
  label: string
  kind:
    | 'string'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'enum_multi'
    | 'user'
    | 'multifield'
    | 'company_ref'
    | 'money'
}

export const CONTACT_FIELDS: FieldDef[] = [
  { key: 'NAME', label: 'Primeiro nome', kind: 'string' },
  { key: 'LAST_NAME', label: 'Sobrenome', kind: 'string' },
  { key: 'POST', label: 'Posição', kind: 'string' },
  { key: 'COMPANY_ID', label: 'Empresa', kind: 'company_ref' },
  { key: 'PHONE', label: 'Telefone', kind: 'multifield' },
  { key: 'EMAIL', label: 'E-mail', kind: 'multifield' },
  { key: 'ASSIGNED_BY_ID', label: 'Responsável Zion', kind: 'user' },
  { key: 'DATE_CREATE', label: 'Criado em', kind: 'datetime' },
  { key: 'COMMENTS', label: 'Observação', kind: 'string' },
  { key: 'UF_CRM_3E1F9F8E', label: 'Cargo', kind: 'enum' },
  { key: 'UF_CRM_A544081', label: 'Cargo Principal', kind: 'enum' },
  { key: 'UF_CRM_B3E03547', label: 'Setor', kind: 'enum' },
  { key: 'UF_CRM_D9A65D75', label: 'Setor Principal', kind: 'enum' },
  { key: 'UF_CRM_CE488DC', label: 'Papel na compra', kind: 'enum' },
  { key: 'UF_CRM_4180E294', label: 'LinkedIn', kind: 'string' },
  { key: 'UF_CRM_773E6B65', label: 'Origem do contato', kind: 'enum' },
  { key: 'UF_CRM_A76E76FC', label: 'Alertas', kind: 'string' },
  { key: 'UF_CRM_61F81473C7321', label: 'Solução alvo', kind: 'enum_multi' },
  { key: 'UF_CRM_61F81473DC1C2', label: 'Ramo Principal', kind: 'enum' },
  { key: 'UF_CRM_61F81473EABC0', label: 'Segmento', kind: 'enum' },
]

export const LEAD_FIELDS: FieldDef[] = [
  { key: 'TITLE', label: 'Nome do Lead', kind: 'string' },
  { key: 'NAME', label: 'Nome', kind: 'string' },
  { key: 'LAST_NAME', label: 'Sobrenome', kind: 'string' },
  { key: 'COMPANY_TITLE', label: 'Empresa', kind: 'string' },
  { key: 'POST', label: 'Posição', kind: 'string' },
  { key: 'STATUS_ID', label: 'Etapa', kind: 'string' },
  { key: 'OPPORTUNITY', label: 'Valor estimado', kind: 'money' },
  { key: 'CURRENCY_ID', label: 'Moeda', kind: 'string' },
  { key: 'PHONE', label: 'Telefone', kind: 'multifield' },
  { key: 'EMAIL', label: 'E-mail', kind: 'multifield' },
  { key: 'ASSIGNED_BY_ID', label: 'Responsável Zion', kind: 'user' },
  { key: 'DATE_CREATE', label: 'Criado em', kind: 'datetime' },
  { key: 'COMMENTS', label: 'Observação', kind: 'string' },
  { key: 'UF_CRM_LEAD_1660840237796', label: 'Prioridade', kind: 'enum' },
  { key: 'UF_CRM_LEAD_1661784402127', label: 'Resp. pelo lead', kind: 'enum' },
  { key: 'UF_CRM_5F835D2B0DF9A', label: 'Solução alvo', kind: 'enum_multi' },
  { key: 'UF_CRM_5F835D2B1BA76', label: 'Ramo Principal', kind: 'enum' },
  { key: 'UF_CRM_5F835D2B26EAD', label: 'Segmento', kind: 'enum' },
  { key: 'UF_CRM_1659116126870', label: 'Empresa (texto)', kind: 'string' },
  { key: 'UF_CRM_1666364542', label: 'Tipo de Contato', kind: 'enum' },
  { key: 'UF_CRM_1775852089', label: 'Motivo descarte', kind: 'enum_multi' },
  { key: 'UF_CRM_1726757013', label: 'Interesse', kind: 'string' },
]

export const COMPANY_FIELDS: FieldDef[] = [
  { key: 'TITLE', label: 'Nome da Empresa', kind: 'string' },
  { key: 'INDUSTRY', label: 'Indústria', kind: 'string' },
  { key: 'REVENUE', label: 'Receita anual', kind: 'money' },
  { key: 'PHONE', label: 'Telefone', kind: 'multifield' },
  { key: 'EMAIL', label: 'E-mail', kind: 'multifield' },
  { key: 'WEB', label: 'Website', kind: 'multifield' },
  { key: 'ASSIGNED_BY_ID', label: 'Responsável Zion', kind: 'user' },
  { key: 'DATE_CREATE', label: 'Criado em', kind: 'datetime' },
  { key: 'COMMENTS', label: 'Observação', kind: 'string' },
  { key: 'UF_CRM_1602279993', label: 'Solução alvo', kind: 'enum_multi' },
  { key: 'UF_CRM_9C92C025', label: 'Ramo Principal', kind: 'enum' },
  { key: 'UF_CRM_F56E1FF4', label: 'Segmento', kind: 'enum' },
  { key: 'UF_CRM_C6C486BD', label: 'Ramo', kind: 'enum' },
  { key: 'UF_CRM_A82B04D', label: 'Porte', kind: 'enum' },
  { key: 'UF_CRM_1B70E8F8', label: 'Tipo de contato', kind: 'enum' },
  { key: 'UF_CRM_1738583536320', label: 'Cliente curva', kind: 'enum' },
  { key: 'UF_CRM_1660051841013', label: 'CS / EV responsável', kind: 'enum' },
  { key: 'UF_CRM_2EAEE777', label: 'ERP', kind: 'enum' },
  { key: 'UF_CRM_442050D8', label: 'WMS/TMS em uso', kind: 'string' },
  { key: 'UF_CRM_1764959733', label: 'Infinity ou On Premisse', kind: 'enum' },
  { key: 'UF_CRM_C3113A4', label: 'Primeiro Contato', kind: 'date' },
  { key: 'UF_CRM_1DCFCF96', label: 'Início de parceria', kind: 'date' },
  { key: 'UF_CRM_28C058AE', label: 'Distrato', kind: 'date' },
  { key: 'UF_CRM_BC24F911', label: 'Módulos adquiridos', kind: 'enum_multi' },
]

export function getFieldsFor(entityType: EntityType): FieldDef[] {
  if (entityType === 'contact') return CONTACT_FIELDS
  if (entityType === 'lead') return LEAD_FIELDS
  if (entityType === 'company') return COMPANY_FIELDS
  if (entityType === 'deal') return []
  throw new Error(`Unknown entity_type: ${entityType}`)
}
