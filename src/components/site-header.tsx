import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b border-border bg-card/40 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="inline-block h-3 w-3 rounded-full bg-primary shadow-[0_0_12px] shadow-primary" />
          <span>CompletionDex</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/" className="px-3 py-2 text-muted-foreground hover:text-foreground" activeOptions={{ exact: true }} activeProps={{ className: "text-foreground" }}>
            Leaderboard
          </Link>
          {user ? (
            <>
              <Link to="/dashboard" className="px-3 py-2 text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
                Dashboard
              </Link>
              <Link to="/log" className="px-3 py-2 text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>
                Log completion
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/" });
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
              <Link to="/signup"><Button size="sm">Sign up</Button></Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
