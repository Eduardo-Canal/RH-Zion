import { Evaluation } from '@/services/evaluations'
import { StarRating } from '@/components/ui/star-rating'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trash2, Calendar, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EvaluationCardProps {
  evaluation: Evaluation
  onDelete: (id: string) => void
  isAdmin: boolean
}

export function EvaluationCard({
  evaluation,
  onDelete,
  isAdmin,
}: EvaluationCardProps) {
  const averageScore = (
    (evaluation.nota_pontualidade +
      evaluation.nota_qualidade +
      evaluation.nota_trabalho_equipe) /
    3
  ).toFixed(1)

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    if (score >= 3.5) return 'text-blue-600 bg-blue-50 border-blue-200'
    if (score >= 2.5) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  return (
    <div className="group relative bg-white border border-ink/5 rounded-[24px] p-6 hover:shadow-elevation transition-all duration-300 hover:-translate-y-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
            <AvatarImage
              src={`https://img.usecurling.com/ppl/thumbnail?gender=${evaluation.colaborador?.image_gender || 'male'}&seed=${evaluation.colaborador_id}`}
            />
            <AvatarFallback>
              {evaluation.colaborador?.nome.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-instrument text-xl leading-tight text-ink">
              {evaluation.colaborador?.nome || 'Colaborador'}
            </h3>
            <p className="text-sm text-ink/50 font-medium">
              {evaluation.colaborador?.cargo || 'Cargo não definido'}
            </p>
          </div>
        </div>
        <div
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-bold border',
            getScoreColor(Number(averageScore)),
          )}
        >
          ★ {averageScore}
        </div>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-3 gap-2 mb-6 bg-cream/50 p-3 rounded-xl border border-ink/5">
        <div className="text-center">
          <span className="text-[10px] uppercase tracking-wide text-ink/40 font-bold block mb-1">
            Pontualidade
          </span>
          <div className="flex justify-center">
            <span className="font-instrument text-lg">
              {evaluation.nota_pontualidade}
            </span>
          </div>
        </div>
        <div className="text-center border-l border-ink/5">
          <span className="text-[10px] uppercase tracking-wide text-ink/40 font-bold block mb-1">
            Qualidade
          </span>
          <div className="flex justify-center">
            <span className="font-instrument text-lg">
              {evaluation.nota_qualidade}
            </span>
          </div>
        </div>
        <div className="text-center border-l border-ink/5">
          <span className="text-[10px] uppercase tracking-wide text-ink/40 font-bold block mb-1">
            Equipe
          </span>
          <div className="flex justify-center">
            <span className="font-instrument text-lg">
              {evaluation.nota_trabalho_equipe}
            </span>
          </div>
        </div>
      </div>

      {/* Observations */}
      <div className="flex-1 mb-6">
        {evaluation.observacoes ? (
          <p className="text-sm text-ink/70 italic line-clamp-3 leading-relaxed">
            "{evaluation.observacoes}"
          </p>
        ) : (
          <p className="text-sm text-ink/30 italic">Sem observações.</p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-ink/5 flex items-center justify-between text-xs text-ink/50">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3" />
            {evaluation.periodo}
          </span>
          <span className="flex items-center gap-1.5" title="Avaliador">
            <UserCheck className="w-3 h-3" />
            by {evaluation.avaliador?.nome.split(' ')[0]}
          </span>
        </div>

        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onDelete(evaluation.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
