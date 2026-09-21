import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sair } from '@/app/login/actions';

/** Quem está logado e a saída. O e-mail some no celular, por espaço. */
export function MenuUsuario({ email }: { email: string | null }) {
  return (
    <div className="flex items-center gap-1">
      {email ? (
        <span
          className="text-muted-foreground hidden max-w-[22ch] truncate text-xs sm:inline"
          title={email}
        >
          {email}
        </span>
      ) : null}

      <form action={sair}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sair do painel">
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
