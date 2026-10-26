import { ModuleTabs } from "@/components/app/nav-links";

export default function ModuleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModuleTabs />
      {children}
    </>
  );
}
