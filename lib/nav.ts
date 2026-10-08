import {
  BarChart3,
  Briefcase,
  FileStack,
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
    status: "live",
    phase: 3,
  },
  { id: "resume", label: "Resume", href: "/resume", icon: FileText, status: "live", phase: 4 },
  { id: "jobs", label: "Jobs", href: "/jobs", icon: Briefcase, status: "live", phase: 5 },
  { id: "matches", label: "Matches", href: "/matches", icon: Target, status: "live", phase: 6 },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileStack,
    status: "live",
    phase: 7,
  },
  { id: "outreach", label: "Outreach", href: "/outreach", icon: Send, status: "live", phase: 8 },
  {
    id: "applications",
    label: "Applications",
    href: "/applications",
    icon: KanbanSquare,
    status: "live",
    phase: 9,
  },
  {
    id: "interviews",
    label: "Interview Hub",
    href: "/interviews",
    icon: MessageSquare,
    status: "live",
    phase: 10,
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    status: "live",
    phase: 11,
  },
  {
    id: "gaps",
    label: "Career Gaps",
    href: "/gaps",
    icon: GraduationCap,
    status: "live",
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
    status: "live",
    phase: 5,
    href: "/jobs",
  },
  {
    id: "analyze-resume",
    label: "Analyze resume",
    keywords: ["upload", "health"],
    status: "live",
    phase: 4,
    href: "/resume",
  },
  {
    id: "find-matches",
    label: "Find matches",
    keywords: ["strength", "rank"],
    status: "live",
    phase: 6,
    href: "/matches",
  },
  {
    id: "optimize-resume",
    label: "Optimize resume",
    keywords: ["tailor"],
    status: "live",
    phase: 7,
    href: "/matches",
  },
  {
    id: "cover-letter",
    label: "Generate cover letter",
    keywords: ["write"],
    status: "live",
    phase: 7,
    href: "/matches",
  },
  {
    id: "prepare-outreach",
    label: "Prepare outreach",
    keywords: ["email", "linkedin"],
    status: "live",
    phase: 8,
    href: "/outreach",
  },
  {
    id: "add-application",
    label: "Add application",
    keywords: ["track", "crm"],
    status: "live",
    phase: 9,
    href: "/applications",
  },
  {
    id: "view-analytics",
    label: "View analytics",
    keywords: ["funnel"],
    status: "live",
    phase: 11,
    href: "/analytics",
  },
  {
    id: "mock-interview",
    label: "Start mock interview",
    keywords: ["practice"],
    status: "live",
    phase: 10,
    href: "/interviews",
  },
];
