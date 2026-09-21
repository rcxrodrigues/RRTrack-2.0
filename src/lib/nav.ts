import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Globe2,
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
  { href: '/geo', label: 'Geo', shortLabel: 'Geo', icon: Globe2 },
  {
    href: '/config',
    label: 'Configuração',
    shortLabel: 'Config',
    icon: Settings,
  },
] as const;

/** A barra inferior do celular não comporta seis itens com conforto. */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter((item) =>
  ['/', '/eventos', '/faturamento', '/campanhas', '/config'].includes(item.href),
);
