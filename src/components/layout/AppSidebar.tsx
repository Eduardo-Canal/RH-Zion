import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Users,
  UserPlus,
  Clock,
  CalendarDays,
  FileBarChart,
  BarChart3,
  Search,
  Filter,
  Building,
  Shield,
  Briefcase,
  Home,
  LogOut,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useUserRole } from '@/hooks/use-user-role'
import { useAuth } from '@/hooks/use-auth'
import { InviteCollaboratorDialog } from '@/components/InviteCollaboratorDialog'
import { toast } from 'sonner'

const menuGroups = [
  {
    label: 'Principal',
    items: [
      {
        title: 'Dashboard',
        url: '/',
        icon: Home,
        roles: ['Admin', 'Gerente', 'Colaborador'],
      },
    ],
  },
  {
    label: 'Gestão',
    items: [
      {
        title: 'Colaboradores',
        url: '/colaboradores',
        icon: Users,
        roles: ['Admin', 'Gerente', 'Colaborador'],
      },
      {
        title: 'Recrutamento',
        url: '/recrutamento',
        icon: Briefcase,
        roles: ['Admin', 'Gerente'],
      },
    ],
  },
  {
    label: 'Operacional',
    items: [
      {
        title: 'Ponto',
        url: '/ponto',
        icon: Clock,
        roles: ['Admin', 'Gerente', 'Colaborador'],
      },
      {
        title: 'Férias',
        url: '/ferias',
        icon: CalendarDays,
        roles: ['Admin', 'Gerente', 'Colaborador'],
      },
    ],
  },
  {
    label: 'Histórico',
    items: [
      {
        title: 'Avaliações',
        url: '/avaliacoes',
        icon: FileBarChart,
        roles: ['Admin', 'Gerente', 'Colaborador'],
      },
      {
        title: 'Relatórios',
        url: '/relatorios',
        icon: BarChart3,
        roles: ['Admin', 'Gerente'],
      },
    ],
  },
]

export function AppSidebar() {
  const { isMobile } = useSidebar()
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { role, loading, organizationName, organizationId } = useUserRole()

  if (loading) return null

  const handleLogout = async () => {
    const { error } = await signOut()
    if (error) {
      toast.error('Erro ao sair', { description: error.message })
      return
    }
    toast.success('Sessão encerrada')
    navigate('/login', { replace: true })
  }

  // Function to check if a route is active (including sub-routes)
  const isRouteActive = (itemUrl: string) => {
    if (itemUrl === '/' && location.pathname !== '/') return false
    return location.pathname.startsWith(itemUrl)
  }

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        'shadow-[4px_0_24px_-4px_rgba(26,26,24,0.06)] border-none',
        isMobile && 'pt-0',
      )}
    >
      <SidebarHeader className="p-6 gap-6">
        <div className="flex items-center justify-between overflow-hidden">
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-2xl font-instrument italic tracking-tight text-sidebar-foreground truncate">
              ADAPTARH
            </span>
            {organizationName && (
              <span className="text-xs text-muted-foreground truncate flex items-center gap-1 font-sans">
                <Building className="h-3 w-3" /> {organizationName}
              </span>
            )}
          </div>
        </div>
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/70" />
          <Input
            placeholder="Pesquisar..."
            className="pl-9 pr-9 bg-white/50 border-sidebar-border/50 focus-visible:ring-1 focus-visible:ring-sidebar-ring h-9 text-sm rounded-full transition-all hover:bg-white/80"
          />
          <Filter className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground/70 cursor-pointer hover:text-foreground transition-colors" />
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        {menuGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => role && item.roles.includes(role),
          )

          if (visibleItems.length === 0) return null

          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-muted-foreground/70 font-sans tracking-widest text-[10px] uppercase pl-2 mb-1">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const isActive = isRouteActive(item.url)
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className={cn(
                            'rounded-xl h-10 transition-all duration-300 font-sans text-[14px]',
                            isActive
                              ? 'bg-salmon text-ink shadow-sm hover:bg-salmon hover:text-ink font-medium'
                              : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:pl-3',
                          )}
                        >
                          <Link
                            to={item.url}
                            className="flex items-center gap-3"
                          >
                            <item.icon
                              className={cn(
                                'h-[18px] w-[18px]',
                                isActive ? 'stroke-[2px]' : 'stroke-[1.5px]',
                              )}
                            />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter className="p-6 group-data-[collapsible=icon]:hidden gap-4">
        {organizationId && (
          <InviteCollaboratorDialog
            organizationId={organizationId}
            organizationName={organizationName}
            trigger={
              <Button
                className="w-full gap-2 shadow-sm rounded-full border-sidebar-border/50 text-sidebar-foreground hover:bg-ink hover:text-cream transition-all duration-300 font-sans"
                variant="outline"
              >
                <UserPlus className="h-4 w-4" />
                Convidar
              </Button>
            }
          />
        )}

        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/40 border border-sidebar-border/40 backdrop-blur-sm transition-all hover:bg-white/60">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-salmon/20 text-ink">
            <Shield className="h-4 w-4 stroke-[1.5px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-sans">
              Nível de Acesso
            </span>
            <span className="text-sm font-semibold text-foreground capitalize truncate font-sans">
              {role || 'Visitante'}
            </span>
          </div>
        </div>

        <Button
          onClick={handleLogout}
          variant="outline"
          className="w-full gap-2 rounded-full border-sidebar-border/50 text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground transition-all duration-300 font-sans"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>

        <div className="text-[10px] text-center text-muted-foreground/60 font-instrument italic">
          ADAPTARH v2.6 &copy; 2026
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
