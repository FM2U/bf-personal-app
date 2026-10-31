import { Notice } from "@/components/app/page-header";
import { DB_UPDATE_NOTICE_0021 } from "@/lib/schema-guard";

/** The Work screens share one width (1120px, as the approved mockup) and the same "Database update needed" notice. */
export function WorkShell({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col" data-testid={testId}>
      {children}
    </div>
  );
}

/** "Database update needed: paste supabase/UPDATE_0021_RUN_ONCE.sql ..." (or the 0020 file when that one is missing). */
export function WorkUpdateNotice({ notice }: { notice?: string | null }) {
  return (
    <div data-testid="work-update-needed">
      <Notice tone="warn">{notice || DB_UPDATE_NOTICE_0021}</Notice>
    </div>
  );
}
