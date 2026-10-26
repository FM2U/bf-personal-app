import { LoginForm } from "../auth-forms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return <LoginForm notice={sp.error === "not_owner" ? "That account is not the owner account." : undefined} />;
}
