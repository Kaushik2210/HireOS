import {
  BarChart3,
  Briefcase,
  FileText,
  GraduationCap,
  KanbanSquare,
  LayoutDashboard,
  MessageSquare,
  Network,
  Rocket,
  Send,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type FeatureStatus = "live" | "planned";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  status: FeatureStatus;
  /** Roadmap phase in which the feature lands. */
  phase: number;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    status: "live",
    phase: 1,
  },
  {
    id: "profile",
    label: "Career Profile",
    href: "/profile",
    icon: UserRound,
    status: "planned",
    phase: 3,
  },
  { id: "resume", label: "Resume", href: "/resume", icon: FileText, status: "planned", phase: 4 },
  { id: "jobs", label: "Jobs", href: "/jobs", icon: Briefcase, status: "planned", phase: 5 },
  { id: "matches", label: "Matches", href: "/matches", icon: Target, status: "planned", phase: 6 },
  { id: "outreach", label: "Outreach", href: "/outreach", icon: Send, status: "planned", phase: 8 },
  {
    id: "applications",
    label: "Applications",
    href: "/applications",
    icon: KanbanSquare,
    status: "planned",
    phase: 9,
  },
  {
    id: "interviews",
    label: "Interview Hub",
    href: "/interviews",
    icon: MessageSquare,
    status: "planned",
    phase: 10,
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    status: "planned",
    phase: 11,
  },
  {
    id: "gaps",
    label: "Career Gaps",
    href: "/gaps",
    icon: GraduationCap,
    status: "planned",
    phase: 11,
  },
  {
    id: "graph",
    label: "Career Graph",
    href: "/graph",
    icon: Network,
    status: "planned",
    phase: 12,
  },
  {
    id: "autopilot",
    label: "Career Autopilot",
    href: "/autopilot",
    icon: Rocket,
    status: "planned",
    phase: 9,
  },
];

export interface PaletteAction {
  id: string;
  label: string;
  keywords: string[];
  status: FeatureStatus;
  phase: number;
  /** Route to open when live. */
  href?: string;
}

/** Command palette actions from the product spec. Only live ones navigate. */
export const PALETTE_ACTIONS: readonly PaletteAction[] = [
  {
    id: "search-jobs",
    label: "Search jobs",
    keywords: ["find", "discover"],
    status: "planned",
    phase: 5,
  },
  {
    id: "analyze-resume",
    label: "Analyze resume",
    keywords: ["upload", "health"],
    status: "planned",
    phase: 4,
  },
  {
    id: "find-matches",
    label: "Find matches",
    keywords: ["strength", "rank"],
    status: "planned",
    phase: 6,
  },
  {
    id: "optimize-resume",
    label: "Optimize resume",
    keywords: ["tailor"],
    status: "planned",
    phase: 7,
  },
  {
    id: "cover-letter",
    label: "Generate cover letter",
    keywords: ["write"],
    status: "planned",
    phase: 7,
  },
  {
    id: "prepare-outreach",
    label: "Prepare outreach",
    keywords: ["email", "linkedin"],
    status: "planned",
    phase: 8,
  },
  {
    id: "add-application",
    label: "Add application",
    keywords: ["track", "crm"],
    status: "planned",
    phase: 9,
  },
  {
    id: "view-analytics",
    label: "View analytics",
    keywords: ["funnel"],
    status: "planned",
    phase: 11,
  },
  {
    id: "mock-interview",
    label: "Start mock interview",
    keywords: ["practice"],
    status: "planned",
    phase: 10,
  },
];
