import { SettingsBack } from "@/components/app/settings-back";

/**
 * Settings is one page (push D). The longer screens it links to (Email signature, Buy box, AI usage, Profile and
 * security, Export, Sample data) show "Settings" above their title to go back.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsBack />
      {children}
    </>
  );
}
