import { Candidate } from '@/services/recruitment'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Mail,
  Phone,
  MoreVertical,
  Pencil,
  FileText,
  Download,
  Loader2,
  Briefcase,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface CandidateCardProps {
  candidate: Candidate
  onEdit: (candidate: Candidate) => void
  onStatusChange: (id: string, status: string) => void
  onCVClick: (id: string) => void
  onDownloadCV: (candidate: Candidate) => void
  uploadingId: string | null
  downloadingId: string | null
}

export function CandidateCard({
  candidate,
  onEdit,
  onStatusChange,
  onCVClick,
  onDownloadCV,
  uploadingId,
  downloadingId,
}: CandidateCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Aprovado':
      case 'Contratado':
        return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200'
      case 'Reprovado':
      case 'Recusado':
        return 'bg-red-100 text-red-800 hover:bg-red-200 border-red-200'
      case 'Entrevista':
        return 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200'
      default:
        return 'bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200'
    }
  }

  return (
    <Card className="group hover:shadow-md transition-all duration-300 border-ink/5 bg-white/50 backdrop-blur-sm overflow-hidden flex flex-col h-full rounded-[24px]">
      <CardHeader className="pb-2 flex flex-row items-start gap-4">
        <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
          <AvatarImage
            src={`https://img.usecurling.com/ppl/thumbnail?gender=${candidate.image_gender}&seed=${candidate.id}`}
          />
          <AvatarFallback>{candidate.nome_candidato.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="font-instrument text-xl truncate text-ink">
            {candidate.nome_candidato}
          </h3>
          <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
            <Briefcase className="w-3 h-3" />
            {candidate.vagas?.titulo || candidate.vaga}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 h-8 w-8 text-muted-foreground hover:text-ink"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(candidate)}>
              <Pencil className="h-4 w-4 mr-2" /> Editar
            </DropdownMenuItem>
            {candidate.curriculo_url && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDownloadCV(candidate)}
                  disabled={downloadingId === candidate.id}
                >
                  {downloadingId === candidate.id ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Baixar CV
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onStatusChange(candidate.id, 'Triagem')}
            >
              Mover para Triagem
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onStatusChange(candidate.id, 'Entrevista')}
            >
              Mover para Entrevista
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onStatusChange(candidate.id, 'Aprovado')}
            >
              Marcar Aprovado
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onStatusChange(candidate.id, 'Reprovado')}
            >
              Marcar Reprovado
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        <div className="space-y-1.5">
          {candidate.email && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground truncate">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{candidate.email}</span>
            </div>
          )}
          {candidate.telefone && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground truncate">
              <Phone className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{candidate.telefone}</span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="pt-3 border-t border-ink/5 bg-ink/[0.02] flex justify-between items-center gap-2">
        <Badge
          variant="outline"
          className={cn('font-normal border', getStatusColor(candidate.status))}
        >
          {candidate.status}
        </Badge>

        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 px-2 text-xs',
            candidate.curriculo_url
              ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
              : 'text-muted-foreground',
          )}
          onClick={() => onCVClick(candidate.id)}
          disabled={uploadingId === candidate.id}
        >
          {uploadingId === candidate.id ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <FileText className="h-3 w-3 mr-1" />
          )}
          {candidate.curriculo_url ? 'CV Anexado' : 'Anexar CV'}
        </Button>
      </CardFooter>
    </Card>
  )
}
