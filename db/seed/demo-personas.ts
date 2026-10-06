import type { z } from "zod";
import {
  achievementSchema,
  careerGoalSchema,
  certificationSchema,
  educationSchema,
  experienceSchema,
  profileSchema,
  projectSchema,
  skillSchema,
  type Achievement,
  type CareerGoalData,
  type Certification,
  type Education,
  type Experience,
  type ProfileData,
  type Project,
  type Skill,
} from "@/lib/profile/schemas";

/**
 * Fictional candidates for demo mode. Names, employers and institutions are invented.
 * Everything is validated against the real schemas when this module loads, so the demo
 * data can never drift out of what the product accepts.
 */
interface PersonaInput {
  id: string;
  label: string;
  blurb: string;
  profile: z.input<typeof profileSchema>;
  goals: z.input<typeof careerGoalSchema>;
  education: z.input<typeof educationSchema>[];
  experiences: z.input<typeof experienceSchema>[];
  projects: z.input<typeof projectSchema>[];
  certifications: z.input<typeof certificationSchema>[];
  skills: z.input<typeof skillSchema>[];
  achievements: z.input<typeof achievementSchema>[];
}

export interface Persona {
  id: string;
  label: string;
  blurb: string;
  profile: ProfileData;
  goals: CareerGoalData;
  education: Education[];
  experiences: Experience[];
  projects: Project[];
  certifications: Certification[];
  skills: Skill[];
  achievements: Achievement[];
}

const INPUTS: PersonaInput[] = [
  {
    id: "asha",
    label: "Asha Raman: MCA student, backend and full-stack",
    blurb:
      "Final-year MCA student with two backend projects and one internship. No container tooling yet.",
    profile: {
      full_name: "Asha Raman",
      headline: "MCA student building backend services with Python and PostgreSQL",
      summary:
        "Final-year MCA student who enjoys designing clean APIs and relational schemas. Built a placement tracker used by a campus cell and completed a backend internship. Looking for a junior backend or full-stack role.",
      location: "Pune, India",
      linkedin_url: "https://www.linkedin.com/in/asha-raman-demo",
      github_url: "https://github.com/asha-raman-demo",
      experience_level: "entry",
      work_modes: ["hybrid", "remote"],
      job_types: ["full_time"],
      preferred_locations: ["Pune", "Bengaluru", "Remote"],
      open_to_relocate: true,
      expected_salary_min: 600000,
      expected_salary_max: 900000,
      salary_currency: "INR",
      salary_period: "year",
    },
    goals: {
      target_roles: ["Backend Engineer", "Full-Stack Developer"],
      target_level: "entry",
      timeline_months: 6,
      statement: "Land a junior backend role at a product company and grow into system design.",
    },
    education: [
      {
        institution: "Riverside Institute of Technology",
        degree: "Master of Computer Applications",
        field_of_study: "Computer Applications",
        start_date: "2024-08",
        end_date: "2026-06",
        grade: "CGPA 8.4 / 10",
        highlights: ["Coursework: advanced databases, distributed systems, software engineering"],
      },
      {
        institution: "St. Mary's College",
        degree: "Bachelor of Computer Applications",
        field_of_study: "Computer Applications",
        start_date: "2021-07",
        end_date: "2024-05",
        grade: "81%",
      },
    ],
    experiences: [
      {
        kind: "internship",
        organization: "Brightleaf Software",
        title: "Backend Developer Intern",
        location: "Pune, India",
        start_date: "2025-05",
        end_date: "2025-07",
        highlights: [
          "Built three REST endpoints for an internal reporting service using Django and PostgreSQL",
          "Wrote database migrations and added indexes that cut a slow report query from 4 s to 600 ms",
          "Added unit tests for the new endpoints and fixed 12 bugs from the team backlog",
        ],
        skills: ["Python", "Django", "PostgreSQL", "REST APIs", "Git"],
      },
    ],
    projects: [
      {
        name: "Campus Placement Tracker",
        role: "Solo developer",
        description:
          "Web app that lets a placement cell publish drives and track student applications.",
        repo_url: "https://github.com/asha-raman-demo/placement-tracker",
        start_date: "2025-01",
        end_date: "2025-04",
        tech: ["Python", "Django", "PostgreSQL", "React"],
        highlights: [
          "Designed a normalized schema with 9 tables covering students, drives, rounds and results",
          "Used by the college placement cell to track 300+ student applications",
          "Added role-based access so students only see their own applications",
        ],
      },
      {
        name: "Expense Splitter API",
        role: "Solo developer",
        description:
          "REST API for splitting shared expenses between friends with simple settlement logic.",
        repo_url: "https://github.com/asha-raman-demo/expense-splitter",
        start_date: "2024-10",
        end_date: "2024-12",
        tech: ["Python", "FastAPI", "SQLite"],
        highlights: [
          "Implemented a settlement algorithm that minimizes the number of repayments",
          "Wrote 40 automated tests covering the settlement edge cases",
        ],
      },
    ],
    certifications: [
      {
        name: "PostgreSQL Fundamentals",
        issuer: "OpenLearn Academy",
        issued_date: "2025-02",
        credential_id: "OLA-PG-20251",
      },
    ],
    skills: [
      { name: "Python", type: "language", level: "advanced", years: 3 },
      { name: "Java", type: "language", level: "intermediate", years: 2 },
      { name: "SQL", type: "language", level: "advanced", years: 3 },
      { name: "JavaScript", type: "language", level: "intermediate", years: 2 },
      { name: "Django", type: "framework", level: "advanced", years: 2 },
      { name: "FastAPI", type: "framework", level: "intermediate", years: 1 },
      { name: "React", type: "framework", level: "intermediate", years: 1 },
      { name: "REST APIs", type: "framework", level: "advanced", years: 2 },
      { name: "PostgreSQL", type: "database", level: "advanced", years: 2 },
      { name: "SQLite", type: "database", level: "intermediate", years: 2 },
      { name: "Git", type: "tool", level: "advanced", years: 3 },
      { name: "Data Structures", type: "domain", level: "advanced", years: 3 },
      { name: "Communication", type: "soft", level: "intermediate", years: null },
    ],
    achievements: [
      {
        title: "Finalist, Inter-college Hackathon",
        category: "competition",
        description: "Reached the final round among 60 teams with a campus-safety reporting app.",
        achieved_on: "2025-03",
      },
    ],
  },
  {
    id: "rohan",
    label: "Rohan Mehta: data analyst",
    blurb: "Analytics-focused graduate with BI dashboards and a churn-prediction project.",
    profile: {
      full_name: "Rohan Mehta",
      headline: "Data analyst turning messy sales data into decisions",
      summary:
        "Analytics graduate with hands-on experience in SQL, Python and Power BI. Built dashboards used by a regional retail team and a churn model that beat the baseline. Seeking a data analyst role.",
      location: "Hyderabad, India",
      experience_level: "junior",
      work_modes: ["hybrid", "onsite"],
      job_types: ["full_time"],
      preferred_locations: ["Hyderabad", "Bengaluru"],
      open_to_relocate: false,
      expected_salary_min: 500000,
      expected_salary_max: 800000,
      salary_currency: "INR",
      salary_period: "year",
    },
    goals: {
      target_roles: ["Data Analyst", "Business Analyst"],
      target_level: "junior",
      timeline_months: 4,
      statement: "Join an analytics team and move toward analytics engineering.",
    },
    education: [
      {
        institution: "Lakeshore University",
        degree: "Bachelor of Science",
        field_of_study: "Statistics",
        start_date: "2020-07",
        end_date: "2023-05",
        grade: "CGPA 8.1 / 10",
      },
    ],
    experiences: [
      {
        kind: "work",
        organization: "Orchard Retail Analytics",
        title: "Junior Data Analyst",
        location: "Hyderabad, India",
        start_date: "2023-07",
        end_date: "2025-06",
        highlights: [
          "Built 6 Power BI dashboards tracking weekly sales across 40 stores",
          "Automated a weekly Excel reporting process with Python, saving about 5 hours a week",
          "Presented monthly findings to regional managers",
        ],
        skills: ["SQL", "Power BI", "Python", "Excel"],
      },
    ],
    projects: [
      {
        name: "Customer Churn Model",
        role: "Solo developer",
        description:
          "Classification model predicting which subscribers will cancel within 30 days.",
        start_date: "2024-02",
        end_date: "2024-04",
        tech: ["Python", "Pandas", "scikit-learn"],
        highlights: [
          "Engineered 14 behavioural features from usage logs",
          "Reached 0.81 AUC against a 0.70 baseline on a held-out set",
        ],
      },
    ],
    certifications: [
      {
        name: "Data Visualization with Tableau",
        issuer: "OpenLearn Academy",
        issued_date: "2024-01",
      },
    ],
    skills: [
      { name: "SQL", type: "language", level: "advanced", years: 3 },
      { name: "Python", type: "language", level: "intermediate", years: 3 },
      { name: "Pandas", type: "data_ml", level: "advanced", years: 3 },
      { name: "scikit-learn", type: "data_ml", level: "intermediate", years: 1 },
      { name: "Power BI", type: "data_ml", level: "advanced", years: 2 },
      { name: "Tableau", type: "data_ml", level: "intermediate", years: 1 },
      { name: "Excel", type: "data_ml", level: "expert", years: 4 },
      { name: "Data Analysis", type: "data_ml", level: "advanced", years: 3 },
      { name: "PostgreSQL", type: "database", level: "intermediate", years: 2 },
      { name: "Communication", type: "soft", level: "advanced", years: null },
    ],
    achievements: [],
  },
  {
    id: "meera",
    label: "Meera Nair: full-stack engineer, 1.5 years",
    blurb: "TypeScript full-stack engineer with production experience, Docker and AWS.",
    profile: {
      full_name: "Meera Nair",
      headline: "Full-stack engineer shipping TypeScript products end to end",
      summary:
        "Engineer with 18 months in a product startup building customer-facing features in React and Node.js, plus the CI and container setup behind them. Looking for a mid-level full-stack role.",
      location: "Bengaluru, India",
      github_url: "https://github.com/meera-nair-demo",
      experience_level: "junior",
      work_modes: ["remote", "hybrid"],
      job_types: ["full_time"],
      preferred_locations: ["Bengaluru", "Remote"],
      open_to_relocate: false,
      expected_salary_min: 1400000,
      expected_salary_max: 1900000,
      salary_currency: "INR",
      salary_period: "year",
    },
    goals: {
      target_roles: ["Full-Stack Engineer", "Frontend Engineer"],
      target_level: "mid",
      timeline_months: 3,
      statement: "Move to a team with stronger engineering practices and mentorship.",
    },
    education: [
      {
        institution: "Coastal Institute of Engineering",
        degree: "Bachelor of Technology",
        field_of_study: "Computer Science",
        start_date: "2019-08",
        end_date: "2023-05",
        grade: "CGPA 8.7 / 10",
      },
    ],
    experiences: [
      {
        kind: "work",
        organization: "Lumen Labs",
        title: "Software Engineer",
        location: "Bengaluru, India",
        start_date: "2023-07",
        is_current: true,
        highlights: [
          "Built the customer onboarding flow in React and TypeScript, lifting completion from 52% to 71%",
          "Containerized three Node.js services with Docker and set up GitHub Actions pipelines",
          "Reduced average API response time by 35% by caching hot queries in Redis",
        ],
        skills: ["TypeScript", "React", "Node.js", "Docker", "GitHub Actions", "Redis"],
      },
    ],
    projects: [
      {
        name: "Open-source Markdown Notes",
        role: "Maintainer",
        description: "Local-first notes app with Markdown editing and full-text search.",
        repo_url: "https://github.com/meera-nair-demo/md-notes",
        start_date: "2023-01",
        end_date: "2023-06",
        tech: ["TypeScript", "React", "SQLite"],
        highlights: ["Accepted 9 community pull requests", "Reached 280 GitHub stars"],
      },
    ],
    certifications: [
      {
        name: "Cloud Practitioner Foundations",
        issuer: "OpenLearn Academy",
        issued_date: "2024-05",
      },
    ],
    skills: [
      { name: "TypeScript", type: "language", level: "advanced", years: 2 },
      { name: "JavaScript", type: "language", level: "advanced", years: 3 },
      { name: "React", type: "framework", level: "advanced", years: 2 },
      { name: "Next.js", type: "framework", level: "intermediate", years: 1 },
      { name: "Node.js", type: "framework", level: "advanced", years: 2 },
      { name: "PostgreSQL", type: "database", level: "intermediate", years: 2 },
      { name: "Redis", type: "database", level: "intermediate", years: 1 },
      { name: "Docker", type: "cloud_devops", level: "intermediate", years: 1.5 },
      { name: "AWS", type: "cloud_devops", level: "beginner", years: 1 },
      { name: "GitHub Actions", type: "cloud_devops", level: "intermediate", years: 1.5 },
      { name: "Git", type: "tool", level: "advanced", years: 4 },
    ],
    achievements: [
      {
        title: "Engineering excellence award",
        category: "award",
        description: "Recognised company-wide for the onboarding redesign.",
        achieved_on: "2024-12",
      },
    ],
  },
];

function build(input: PersonaInput): Persona {
  return {
    id: input.id,
    label: input.label,
    blurb: input.blurb,
    profile: profileSchema.parse(input.profile),
    goals: careerGoalSchema.parse(input.goals),
    education: input.education.map((v) => educationSchema.parse(v)),
    experiences: input.experiences.map((v) => experienceSchema.parse(v)),
    projects: input.projects.map((v) => projectSchema.parse(v)),
    certifications: input.certifications.map((v) => certificationSchema.parse(v)),
    skills: input.skills.map((v) => skillSchema.parse(v)),
    achievements: input.achievements.map((v) => achievementSchema.parse(v)),
  };
}

export const DEMO_PERSONAS: readonly Persona[] = INPUTS.map(build);

export function getPersona(id: string): Persona | undefined {
  return DEMO_PERSONAS.find((p) => p.id === id);
}
