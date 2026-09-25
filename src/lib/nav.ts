import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Palette,
  BarChart3,
  FileText,
  LayoutDashboard,
  Settings,
  Wallet,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  /** Rótulo curto para a barra inferior do celular. */
  shortLabel: string;
  icon: LucideIcon;
};

/** Navegação do painel. Fonte única para a sidebar e para a barra do celular. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/',
    label: 'Visão geral',
    shortLabel: 'Geral',
    icon: LayoutDashboard,
  },
  { href: '/eventos', label: 'Eventos', shortLabel: 'Eventos', icon: Activity },
  {
    href: '/faturamento',
    label: 'Faturamento',
    shortLabel: 'Receita',
    icon: Wallet,
  },
  {
    href: '/campanhas',
    label: 'Campanhas',
    shortLabel: 'Campanhas',
    icon: BarChart3,
  },
  {
    href: '/paginas',
    label: 'Páginas',
    shortLabel: 'Páginas',
    icon: FileText,
  },
  {
    href: '/config',
    label: 'Configuração',
    shortLabel: 'Config',
    icon: Settings,
  },
  { href: '/estilo', label: 'Estilo', shortLabel: 'Estilo', icon: Palette },
] as const;

/**
 * A barra inferior do celular não comporta a lista inteira com conforto.
 *
 * Fica com as cinco que se olha no celular: o resto é trabalho de mesa.
 */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter((item) =>
  ['/', '/eventos', '/faturamento', '/campanhas', '/config'].includes(item.href),
);
