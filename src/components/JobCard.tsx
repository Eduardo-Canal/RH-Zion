import { Job } from '@/services/jobs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Briefcase,
  Building2,
  MoreVertical,
  Users,
  Link as LinkIcon,
  ExternalLink,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface JobCardProps {
  job: Job
  onEdit: (job: Job) => void
  onCopyLink: (id: string) => void
  onViewPublic: (id: string) => void
}

export function JobCard({
  job,
  onEdit,
  onCopyLink,
  onViewPublic,
}: JobCardProps) {
  const isClosed = job.status === 'Fechada'

  return (
    <Card className="group hover:shadow-lg transition-all duration-300 border-ink/5 bg-white/50 backdrop-blur-sm overflow-hidden flex flex-col h-full rounded-[24px]">
      <CardHeader className="pb-3 relative">
        <div className="flex justify-between items-start">
          <Badge
            variant={isClosed ? 'secondary' : 'default'}
            className={cn(
              'mb-2',
              !isClosed && 'bg-emerald-600 hover:bg-emerald-700',
            )}
          >
            {job.status}
          </Badge>
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
              <DropdownMenuItem onClick={() => onEdit(job)}>
                <Pencil className="mr-2 h-4 w-4" /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyLink(job.id)}>
                <LinkIcon className="mr-2 h-4 w-4" /> Copiar Link
              </DropdownMenuItem>
              {!isClosed && (
                <DropdownMenuItem onClick={() => onViewPublic(job.id)}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Ver Pública
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardTitle className="font-instrument text-2xl leading-tight text-ink">
          {job.titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-salmon" />
            <span>{job.departamento}</span>
          </div>
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 shrink-0 text-periwinkle" />
            <span>{job.tipo_contrato}</span>
          </div>
          {job.salario > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">
                R$ {job.salario.toLocaleString('pt-BR')}
              </span>
            </div>
          )}
        </div>

        {job.descricao && (
          <p className="text-sm text-ink/60 line-clamp-2 mt-2">
            {job.descricao}
          </p>
        )}
      </CardContent>
      <CardFooter className="pt-3 border-t border-ink/5 bg-ink/[0.02] flex justify-between items-center">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink/70">
          <Users className="h-4 w-4" />
          <span>{job.candidates_count || 0} candidatos</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {format(new Date(job.created_at), 'd MMM, yyyy', { locale: ptBR })}
        </span>
      </CardFooter>
    </Card>
  )
}
