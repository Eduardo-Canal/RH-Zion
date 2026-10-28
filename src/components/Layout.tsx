import { Outlet } from 'react-router-dom'
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { useIsMobile } from '@/hooks/use-mobile'

export default function Layout() {
  const isMobile = useIsMobile()

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      {/* Main App Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <SidebarInset className="flex flex-col w-full overflow-hidden">
        {/* Mobile Header for Sidebar Trigger */}
        <header className="flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
          <SidebarTrigger />
          <span className="font-semibold">ADAPTARH</span>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-[#F9FAFB] dark:bg-zinc-950 relative">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
