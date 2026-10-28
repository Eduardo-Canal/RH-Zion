import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react'
import { Employee } from '@/services/employees'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

interface EmployeeCardProps {
  employee: Employee
  onEdit: (employee: Employee) => void
  onDelete: (id: string) => void
  onRoleUpdate: (id: string, role: string) => void
  canEdit: boolean
  isAdmin: boolean
}

export function EmployeeCard({
  employee,
  onEdit,
  onDelete,
  onRoleUpdate,
  canEdit,
  isAdmin,
}: EmployeeCardProps) {
  return (
    <div className="group relative bg-white/50 backdrop-blur-sm border border-ink/5 rounded-[24px] p-6 hover:shadow-elevation hover:bg-white/80 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start gap-3 mb-4 pr-8">
        <Avatar className="h-16 w-16 border-2 border-white shadow-sm">
          <AvatarImage
            src={`https://img.usecurling.com/ppl/medium?gender=${employee.image_gender || 'male'}&seed=${employee.id}`}
          />
          <AvatarFallback className="bg-periwinkle text-ink font-instrument text-xl">
            {employee.nome.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <Badge
          variant="outline"
          className={cn(
            'mt-1',
            employee.status === 'Ativo' && 'bg-sage/20 text-ink border-sage/50',
            employee.status === 'Férias' &&
              'bg-periwinkle/20 text-ink border-periwinkle/50',
            employee.status === 'Desligado' &&
              'bg-salmon/20 text-ink border-salmon/50',
          )}
        >
          {employee.status}
        </Badge>
      </div>

      <div className="space-y-1 mb-4">
        <h3 className="font-instrument text-2xl leading-tight text-ink">
          {employee.nome}
        </h3>
        <p className="text-sm font-medium text-ink/60 uppercase tracking-wide">
          {employee.cargo}
        </p>
      </div>

      <div className="space-y-2 text-sm text-ink/70 mb-6">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" />
          <span className="truncate">{employee.email}</span>
        </div>
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5" />
          <span>{employee.telefone}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate">{employee.departamento}</span>
        </div>
      </div>

      {canEdit && (
        <div className="absolute top-4 right-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-ink/5"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Ações</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEdit(employee)}>
                <Pencil className="mr-2 h-4 w-4" /> Editar
              </DropdownMenuItem>

              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Acesso</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={employee.role}
                    onValueChange={(value) => onRoleUpdate(employee.id, value)}
                  >
                    <DropdownMenuRadioItem value="Colaborador">
                      Colaborador
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Gerente">
                      Gerente
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Admin">
                      Admin
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(employee.id)}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
