import { useState, useEffect } from 'react'
import {
  Search,
  Users,
  UserPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmployeeForm } from '@/components/forms/EmployeeForm'
import { type EmployeeFormValues } from '@/components/forms/employee-schema'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  type Employee,
} from '@/services/employees'
import { useUserRole } from '@/hooks/use-user-role'
import { useAuth } from '@/hooks/use-auth'
import { EmployeeCard } from '@/components/EmployeeCard'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import { cn } from '@/lib/utils'

export default function Colaboradores() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [view, setView] = useState<'cards' | 'table'>('cards')

  const { toast } = useToast()
  const { role, isEmployee, isAdmin, isManager, organizationId } = useUserRole()
  const { user } = useAuth()

  const fetchEmployees = async () => {
    try {
      const userIdToFilter = isEmployee && user ? user.id : undefined
      const data = await getEmployees(userIdToFilter)
      setEmployees(data)
    } catch (error) {
      console.error(error)
      toast({
        title: 'Erro ao carregar',
        description: 'Não foi possível carregar os colaboradores.',
        variant: 'destructive',
      })
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    fetchEmployees()
  }, [role, user])

  const filteredEmployees = employees.filter(
    (e) =>
      e.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.cargo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.departamento.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleSubmit = async (data: EmployeeFormValues, files: File[]) => {
    if (!organizationId) {
      toast({
        title: 'Erro de organização',
        description: 'Não foi possível identificar a organização.',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      const empData = {
        nome: data.nome,
        cpf: data.cpf,
        rg: data.rg || '',
        data_nascimento: format(data.data_nascimento, 'yyyy-MM-dd'),
        endereco: data.endereco,
        email: data.email,
        telefone: data.telefone,
        cargo: data.cargo,
        departamento: data.departamento,
        data_admissao: format(data.data_admissao, 'yyyy-MM-dd'),
        salario: data.salario,
        tipo_contrato: data.tipo_contrato,
        status: data.status,
        image_gender: data.image_gender,
        role: data.role,
        organization_id: organizationId,
        documentos_urls: editingEmployee?.documentos_urls || [],
      }

      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, empData)
        toast({
          title: 'Colaborador atualizado',
          description: `${data.nome} atualizado.`,
        })
      } else {
        await createEmployee(empData)
        toast({
          title: 'Colaborador criado',
          description: `${data.nome} criado.`,
        })
      }

      await fetchEmployees()
      setIsDialogOpen(false)
      setEditingEmployee(null)
    } catch (error) {
      console.error(error)
      toast({ title: 'Erro ao salvar', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (deletingId) {
      try {
        await deleteEmployee(deletingId)
        await fetchEmployees()
        toast({ title: 'Colaborador removido', variant: 'destructive' })
      } catch (error) {
        toast({ title: 'Erro ao remover', variant: 'destructive' })
      }
      setDeletingId(null)
    }
  }

  const handleRoleUpdate = async (employeeId: string, newRole: string) => {
    try {
      await updateEmployee(employeeId, { role: newRole as any })
      toast({
        title: 'Permissão atualizada',
        description: `Acesso alterado para ${newRole}.`,
      })
      await fetchEmployees()
    } catch (error) {
      toast({ title: 'Erro ao atualizar', variant: 'destructive' })
    }
  }

  const canEdit = isAdmin || isManager
  const activeCount = employees.filter((e) => e.status === 'Ativo').length
  const deptCount = new Set(employees.map((e) => e.departamento)).size

  const mapToFormValues = (emp: Employee): EmployeeFormValues => ({
    nome: emp.nome,
    cpf: emp.cpf,
    rg: emp.rg,
    data_nascimento: new Date(emp.data_nascimento),
    endereco: emp.endereco,
    email: emp.email,
    telefone: emp.telefone,
    cargo: emp.cargo,
    departamento: emp.departamento,
    data_admissao: new Date(emp.data_admissao),
    salario: emp.salario,
    tipo_contrato: emp.tipo_contrato,
    status: emp.status,
    role: emp.role as any,
    image_gender: (emp.image_gender as 'male' | 'female') || 'male',
  })

  return (
    <div className="min-h-screen bg-cream font-sans text-ink pb-12">
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto">
          <span className="text-xl font-medium tracking-tight font-instrument">
            Equipe.
          </span>
        </div>
      </nav>

      <div className="px-4 md:px-6 lg:px-8 pt-6 max-w-[1600px] mx-auto animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
          {/* Hero Card */}
          <div className="col-span-1 md:col-span-8 bg-salmon rounded-[24px] p-8 md:p-12 relative overflow-hidden min-h-[300px] flex flex-col justify-between group">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <svg
                className="w-[200%] h-full animate-drift"
                viewBox="0 0 200 100"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,20 Q50,80 100,20 T200,20"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="0.5"
                />
                <path
                  d="M0,80 Q50,140 100,80 T200,80"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="0.5"
                />
              </svg>
            </div>
            <div className="relative z-10">
              <h1 className="font-instrument text-5xl md:text-7xl leading-[0.9] tracking-tight text-ink max-w-2xl">
                Talentos & <br />
                <span className="italic">Cultura</span>
              </h1>
              <p className="text-ink/80 text-lg mt-4 max-w-md font-medium">
                Gerencie os colaboradores da sua organização com eficiência e
                estilo.
              </p>
            </div>
            <div className="relative z-10 flex gap-8 mt-8">
              <div>
                <span className="block font-instrument text-4xl">
                  {activeCount}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Ativos
                </span>
              </div>
              <div>
                <span className="block font-instrument text-4xl">
                  {deptCount}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Departamentos
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions / Search */}
          <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
            <div className="bg-white/50 backdrop-blur-sm border border-ink/5 rounded-[24px] p-6 flex-1 flex flex-col justify-center gap-4 group hover:bg-white/80 transition-colors">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-ink/40" />
                <Input
                  placeholder="Buscar colaborador..."
                  className="pl-10 bg-cream/50 border-ink/10 h-10 rounded-xl focus:ring-salmon"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              {canEdit && (
                <Dialog
                  open={isDialogOpen}
                  onOpenChange={(open) => {
                    setIsDialogOpen(open)
                    if (!open) setEditingEmployee(null)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button className="w-full h-12 rounded-xl bg-ink text-cream hover:bg-salmon hover:text-ink transition-all font-medium text-base">
                      <UserPlus className="mr-2 h-5 w-5" /> Adicionar
                      Colaborador
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl p-8 border-none shadow-2xl bg-[#FCFAF7]">
                    <DialogHeader>
                      <DialogTitle className="font-instrument text-4xl text-ink">
                        {editingEmployee
                          ? 'Editar Colaborador'
                          : 'Novo Colaborador'}
                      </DialogTitle>
                    </DialogHeader>
                    <EmployeeForm
                      initialData={
                        editingEmployee
                          ? {
                              ...mapToFormValues(editingEmployee),
                              id: editingEmployee.id,
                              documentos_urls:
                                editingEmployee.documentos_urls as any,
                            }
                          : null
                      }
                      onSubmit={handleSubmit}
                      onCancel={() => setIsDialogOpen(false)}
                      isLoading={isLoading}
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>

            {/* Decorative Mini Card */}
            <div className="bg-sage rounded-[24px] p-6 flex items-center justify-between relative overflow-hidden group h-32">
              <div className="relative z-10">
                <span className="block font-instrument text-2xl">Equipe</span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                  Total
                </span>
              </div>
              <span className="relative z-10 font-instrument text-5xl">
                {employees.length}
              </span>
              <div className="absolute right-[-20px] bottom-[-20px] opacity-20 group-hover:scale-110 transition-transform">
                <Users className="w-24 h-24" />
              </div>
            </div>
          </div>

          {/* View Switcher */}
          <div className="col-span-1 md:col-span-12 flex justify-end">
            <ViewSwitcher view={view} setView={setView} />
          </div>

          {/* Employee Grid/Table */}
          <div className="col-span-1 md:col-span-12">
            {dataLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-salmon" />
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="text-center py-20 bg-ink/5 rounded-[24px]">
                <p className="font-instrument text-2xl text-ink/40 italic">
                  Nenhum colaborador encontrado.
                </p>
              </div>
            ) : view === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                {filteredEmployees.map((emp) => (
                  <EmployeeCard
                    key={emp.id}
                    employee={emp}
                    onEdit={(e) => {
                      setEditingEmployee(e)
                      setIsDialogOpen(true)
                    }}
                    onDelete={(id) => setDeletingId(id)}
                    onRoleUpdate={handleRoleUpdate}
                    canEdit={canEdit}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-ink/5 bg-white/50 backdrop-blur-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-ink/5">
                    <TableRow className="hover:bg-transparent border-ink/5">
                      <TableHead className="text-ink font-medium">
                        Nome
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Cargo
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Departamento
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Status
                      </TableHead>
                      {canEdit && (
                        <TableHead className="text-right text-ink font-medium">
                          Ações
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEmployees.map((emp) => (
                      <TableRow
                        key={emp.id}
                        className="border-ink/5 hover:bg-white/60"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-white shadow-sm">
                              <AvatarImage
                                src={`https://img.usecurling.com/ppl/thumbnail?gender=${emp.image_gender || 'male'}&seed=${emp.id}`}
                              />
                              <AvatarFallback className="bg-periwinkle text-ink text-xs">
                                {emp.nome.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-ink">
                              {emp.nome}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {emp.cargo}
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {emp.departamento}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'font-normal',
                              emp.status === 'Ativo' &&
                                'bg-sage/20 text-ink border-sage/50',
                              emp.status === 'Férias' &&
                                'bg-periwinkle/20 text-ink border-periwinkle/50',
                              emp.status === 'Desligado' &&
                                'bg-salmon/20 text-ink border-salmon/50',
                            )}
                          >
                            {emp.status}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 hover:bg-ink/5"
                                >
                                  <MoreHorizontal className="h-4 w-4 text-ink/50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Ações</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingEmployee(emp)
                                    setIsDialogOpen(true)
                                  }}
                                >
                                  <Pencil className="mr-2 h-4 w-4" /> Editar
                                </DropdownMenuItem>
                                {isAdmin && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>
                                      Acesso
                                    </DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                      value={emp.role}
                                      onValueChange={(value) =>
                                        handleRoleUpdate(emp.id, value)
                                      }
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
                                  onClick={() => setDeletingId(emp.id)}
                                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-instrument text-2xl">
              Tem certeza?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação excluirá permanentemente o colaborador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600 rounded-full"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
