// Lê funil/etapa para leads de feira. Usa 'bitrix24_feira_defaults' se existir;
// senão cai no 'bitrix24_defaults' geral.
export async function getFeiraBitrixConfig(
  supabase: any,
): Promise<{
  kanbanId: string | null
  stageId: string | null
  origem: string
}> {
  for (const key of ['bitrix24_feira_defaults', 'bitrix24_defaults']) {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    const val = data?.value as any
    if (val?.stage_id) {
      return {
        kanbanId: val.kanban_id || null,
        stageId: val.stage_id,
        origem: key,
      }
    }
  }
  return { kanbanId: null, stageId: null, origem: 'nenhuma' }
}
