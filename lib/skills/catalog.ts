import type { SkillType } from "@/lib/profile/constants";

export interface CatalogSkill {
  /** Stable identifier; safe to store and compare. */
  slug: string;
  name: string;
  type: SkillType;
  aliases: readonly string[];
}

type Row = readonly [name: string, type: SkillType, aliases?: readonly string[]];

// Curated and versioned in code so normalization is deterministic and testable.
const ROWS: readonly Row[] = [
  // languages
  ["JavaScript", "language", ["js", "ecmascript", "es6"]],
  ["TypeScript", "language", ["ts"]],
  ["Python", "language", ["python3", "py"]],
  ["Java", "language", ["core java"]],
  ["C", "language"],
  ["C++", "language", ["cpp", "c plus plus"]],
  ["C#", "language", ["csharp", "c sharp"]],
  ["Go", "language", ["golang"]],
  ["Rust", "language"],
  ["Kotlin", "language"],
  ["Swift", "language"],
  ["PHP", "language"],
  ["Ruby", "language"],
  ["Dart", "language"],
  ["R", "language", ["r language"]],
  ["Scala", "language"],
  ["Bash", "language", ["shell scripting", "shell", "sh"]],
  ["SQL", "language", ["structured query language"]],
  ["HTML", "language", ["html5"]],
  ["CSS", "language", ["css3"]],
  // frameworks
  ["React", "framework", ["react.js", "reactjs"]],
  ["Next.js", "framework", ["nextjs", "next"]],
  ["Vue.js", "framework", ["vue", "vuejs"]],
  ["Angular", "framework", ["angularjs", "angular.js"]],
  ["Svelte", "framework", ["sveltekit"]],
  ["Node.js", "framework", ["node", "nodejs"]],
  ["Express", "framework", ["express.js", "expressjs"]],
  ["NestJS", "framework", ["nest.js", "nest"]],
  ["Django", "framework"],
  ["Flask", "framework"],
  ["FastAPI", "framework", ["fast api"]],
  ["Spring Boot", "framework", ["springboot", "spring"]],
  [".NET", "framework", ["dotnet", "asp.net", "asp.net core"]],
  ["Laravel", "framework"],
  ["Ruby on Rails", "framework", ["rails"]],
  ["Flutter", "framework"],
  ["React Native", "framework", ["reactnative"]],
  ["Tailwind CSS", "framework", ["tailwind", "tailwindcss"]],
  ["Bootstrap", "framework"],
  ["Redux", "framework", ["redux toolkit"]],
  ["GraphQL", "framework", ["graph ql"]],
  ["REST APIs", "framework", ["rest", "restful", "restful apis", "rest api"]],
  // databases
  ["PostgreSQL", "database", ["postgres", "psql"]],
  ["MySQL", "database"],
  ["MongoDB", "database", ["mongo"]],
  ["SQLite", "database"],
  ["Redis", "database"],
  ["Oracle", "database", ["oracle db", "oracle database"]],
  ["SQL Server", "database", ["mssql", "microsoft sql server"]],
  ["Firebase", "database", ["firestore"]],
  ["Supabase", "database"],
  ["Elasticsearch", "database", ["elastic search", "opensearch"]],
  ["Cassandra", "database"],
  // cloud and devops
  ["AWS", "cloud_devops", ["amazon web services"]],
  ["Azure", "cloud_devops", ["microsoft azure"]],
  ["Google Cloud", "cloud_devops", ["gcp", "google cloud platform"]],
  ["Docker", "cloud_devops", ["containers", "containerization"]],
  ["Kubernetes", "cloud_devops", ["k8s"]],
  ["Terraform", "cloud_devops"],
  ["CI/CD", "cloud_devops", ["cicd", "ci cd", "continuous integration", "continuous delivery"]],
  ["GitHub Actions", "cloud_devops", ["github action"]],
  ["Jenkins", "cloud_devops"],
  ["Linux", "cloud_devops", ["unix"]],
  ["Nginx", "cloud_devops"],
  ["Vercel", "cloud_devops"],
  // data and ML
  ["Machine Learning", "data_ml", ["ml"]],
  ["Deep Learning", "data_ml", ["dl"]],
  ["NLP", "data_ml", ["natural language processing"]],
  ["Computer Vision", "data_ml", ["cv"]],
  ["TensorFlow", "data_ml", ["tensor flow"]],
  ["PyTorch", "data_ml", ["torch"]],
  ["scikit-learn", "data_ml", ["sklearn", "scikit learn"]],
  ["Pandas", "data_ml"],
  ["NumPy", "data_ml", ["numpy"]],
  ["Power BI", "data_ml", ["powerbi"]],
  ["Tableau", "data_ml"],
  ["Excel", "data_ml", ["microsoft excel", "ms excel"]],
  ["Data Analysis", "data_ml", ["data analytics", "analytics"]],
  ["Data Visualization", "data_ml", ["data viz"]],
  ["Apache Spark", "data_ml", ["spark", "pyspark"]],
  ["Apache Kafka", "data_ml", ["kafka"]],
  ["Airflow", "data_ml", ["apache airflow"]],
  ["ETL", "data_ml", ["data pipelines"]],
  ["LLMs", "data_ml", ["large language models", "llm"]],
  // tools
  ["Git", "tool", ["version control"]],
  ["GitHub", "tool"],
  ["Jira", "tool"],
  ["Postman", "tool"],
  ["Figma", "tool"],
  ["VS Code", "tool", ["vscode", "visual studio code"]],
  ["Jest", "tool"],
  ["Playwright", "tool"],
  ["Selenium", "tool"],
  ["Cypress", "tool"],
  ["Unit Testing", "tool", ["testing", "tdd"]],
  ["Agile", "tool", ["scrum", "agile methodology"]],
  // soft
  ["Communication", "soft", ["written communication", "verbal communication"]],
  ["Teamwork", "soft", ["collaboration", "team player"]],
  ["Leadership", "soft", ["team leadership"]],
  ["Problem Solving", "soft", ["problem-solving"]],
  ["Project Management", "soft"],
  ["Public Speaking", "soft", ["presentation skills", "presentations"]],
  ["Time Management", "soft"],
  // domain
  ["Data Structures", "domain", ["dsa", "data structures and algorithms", "algorithms"]],
  ["System Design", "domain", ["software design", "hld", "lld"]],
  ["Object-Oriented Programming", "domain", ["oop", "oops", "object oriented programming"]],
  ["Operating Systems", "domain", ["os"]],
  ["Computer Networks", "domain", ["networking"]],
  ["Database Management", "domain", ["dbms", "database design"]],
  ["Microservices", "domain", ["micro services"]],
  ["Web Development", "domain", ["web dev", "full stack", "full-stack", "fullstack"]],
  ["Mobile Development", "domain", ["android development", "ios development", "app development"]],
  ["Cybersecurity", "domain", ["information security", "infosec", "security"]],
  ["Cloud Computing", "domain", ["cloud"]],
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/\./g, "dot")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const SKILL_CATALOG: readonly CatalogSkill[] = ROWS.map(([name, type, aliases = []]) => ({
  slug: slugify(name),
  name,
  type,
  aliases,
}));

/** Lowercased, whitespace-collapsed key used for matching. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const INDEX: ReadonlyMap<string, CatalogSkill> = (() => {
  const map = new Map<string, CatalogSkill>();
  for (const skill of SKILL_CATALOG) {
    for (const key of [skill.name, ...skill.aliases]) {
      const k = normalizeKey(key);
      // First definition wins, so an alias can never hijack a canonical name.
      if (!map.has(k)) map.set(k, skill);
    }
  }
  return map;
})();

/** Exact (case-insensitive) match on a canonical name or known alias. No fuzzy guessing. */
export function findCatalogSkill(input: string): CatalogSkill | null {
  return INDEX.get(normalizeKey(input)) ?? null;
}

export interface NormalizedSkill {
  /** Canonical name when recognised, otherwise the user's own text. */
  name: string;
  slug: string | null;
  type: SkillType | null;
  recognised: boolean;
}

export function normalizeSkill(input: string): NormalizedSkill {
  const hit = findCatalogSkill(input);
  if (hit) return { name: hit.name, slug: hit.slug, type: hit.type, recognised: true };
  return { name: input.trim().replace(/\s+/g, " "), slug: null, type: null, recognised: false };
}

/** Catalog skills whose name or alias starts with (or contains) the query, for suggestions. */
export function suggestSkills(query: string, limit = 8): CatalogSkill[] {
  const q = normalizeKey(query);
  if (!q) return [];
  const starts: CatalogSkill[] = [];
  const contains: CatalogSkill[] = [];
  for (const skill of SKILL_CATALOG) {
    const keys = [skill.name, ...skill.aliases].map(normalizeKey);
    if (keys.some((k) => k.startsWith(q))) starts.push(skill);
    else if (q.length >= 2 && keys.some((k) => k.includes(q))) contains.push(skill);
  }
  return [...starts, ...contains].slice(0, limit);
}
