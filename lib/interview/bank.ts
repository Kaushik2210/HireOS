/**
 * The built-in question bank. These are ordinary, widely asked interview questions written
 * for HireOS: nothing is scraped, copied from a company's own process, or produced by a
 * model. `expects` lists groups of words a good answer would usually touch; an answer covers
 * a group when it uses any word in it. That is a prompt for the person, not an answer key:
 * it cannot say whether an answer is correct.
 */

export interface BankQuestion {
  /** Unique within its list; combined with the skill to make a stable id. */
  key: string;
  text: string;
  expects: string[][];
}

/** Technical questions by skill, using the same names as the skill catalogue. */
export const SKILL_QUESTIONS: Record<string, BankQuestion[]> = {
  Python: [
    {
      key: "list-tuple",
      text: "What is the difference between a list and a tuple in Python, and when would you choose each?",
      expects: [
        ["mutable", "immutable", "change"],
        ["tuple"],
        ["list"],
        ["hash", "key", "fixed", "performance", "memory"],
      ],
    },
    {
      key: "generators",
      text: "What is a generator in Python, and why might you use one instead of building a list?",
      expects: [
        ["yield", "generator", "lazy"],
        ["memory", "large", "stream", "iterate"],
      ],
    },
    {
      key: "errors",
      text: "How do you handle errors in a Python program? Describe how you decide what to catch.",
      expects: [
        ["try", "except", "exception"],
        ["specific", "log", "raise", "finally", "retry"],
      ],
    },
  ],
  JavaScript: [
    {
      key: "closures",
      text: "What is a closure in JavaScript? Give an example of where one is useful.",
      expects: [
        ["closure", "scope", "function"],
        ["variable", "remember", "private", "callback", "counter"],
      ],
    },
    {
      key: "async",
      text: "Explain how promises and async/await work, and how you handle an error in each.",
      expects: [
        ["promise", "async", "await"],
        ["then", "catch", "try", "reject", "resolve"],
        ["event loop", "asynchronous", "non-blocking"],
      ],
    },
  ],
  TypeScript: [
    {
      key: "types-vs-interfaces",
      text: "What do you get from TypeScript over plain JavaScript, and where have types caught a mistake for you?",
      expects: [
        ["type", "types", "compile", "static"],
        ["bug", "error", "mistake", "catch", "refactor", "autocomplete"],
      ],
    },
  ],
  Java: [
    {
      key: "oop-java",
      text: "Describe how inheritance, interfaces and composition differ in Java, and which you prefer to reach for first.",
      expects: [
        ["inherit", "extends"],
        ["interface", "implements"],
        ["composition", "compose", "has-a"],
        ["prefer", "because", "flexible", "coupling"],
      ],
    },
  ],
  SQL: [
    {
      key: "joins",
      text: "Explain the difference between an inner join and a left join, with an example of when each fits.",
      expects: [
        ["inner"],
        ["left"],
        ["null", "unmatched", "missing", "all rows"],
        ["example", "for instance", "such as", "customers", "orders"],
      ],
    },
    {
      key: "index",
      text: "What is a database index, why does it speed up reads, and what does it cost?",
      expects: [
        ["index"],
        ["lookup", "search", "scan", "b-tree", "faster", "fast"],
        ["write", "insert", "update", "space", "storage", "slower"],
      ],
    },
    {
      key: "group-by",
      text: "How would you find the top five customers by total spend using SQL?",
      expects: [["group by", "sum", "aggregate"], ["order by", "desc", "limit", "top"], ["join"]],
    },
  ],
  PostgreSQL: [
    {
      key: "transactions",
      text: "What is a transaction in a relational database, and what do ACID properties mean in practice?",
      expects: [
        ["transaction", "commit", "rollback"],
        ["atomic", "consistent", "isolation", "durable", "acid"],
      ],
    },
  ],
  React: [
    {
      key: "state-props",
      text: "What is the difference between props and state in React, and how does data flow between components?",
      expects: [
        ["props"],
        ["state"],
        ["parent", "child", "down", "lift", "callback"],
        ["render", "re-render", "update"],
      ],
    },
    {
      key: "effects",
      text: "When would you use useEffect, and what mistakes have you seen with it?",
      expects: [
        ["useeffect", "effect", "side effect"],
        ["dependency", "dependencies", "cleanup", "infinite", "loop", "fetch"],
      ],
    },
  ],
  "Node.js": [
    {
      key: "event-loop",
      text: "How does Node.js handle many requests at once with a single thread?",
      expects: [
        ["event loop", "asynchronous", "non-blocking", "callback"],
        ["thread", "single", "worker", "i/o", "io"],
      ],
    },
  ],
  Django: [
    {
      key: "orm",
      text: "How does the Django ORM map to the database, and how do you avoid slow queries with it?",
      expects: [
        ["model", "orm", "queryset"],
        ["migration", "migrate"],
        ["select_related", "prefetch_related", "n+1", "index", "query"],
      ],
    },
  ],
  FastAPI: [
    {
      key: "validation",
      text: "How does FastAPI validate requests, and why is that useful in an API?",
      expects: [
        ["pydantic", "schema", "model", "type"],
        ["validate", "validation", "error", "422", "docs", "openapi"],
      ],
    },
  ],
  "REST APIs": [
    {
      key: "design",
      text: "How would you design a REST API for a to-do list? Cover the endpoints, methods and status codes.",
      expects: [
        ["get", "post", "put", "patch", "delete"],
        ["endpoint", "/todos", "resource", "route"],
        ["200", "201", "404", "400", "status code", "status"],
      ],
    },
    {
      key: "idempotent",
      text: "What does it mean for an HTTP method to be idempotent, and which methods are?",
      expects: [["idempotent", "same result", "repeat"], ["put", "delete", "get"], ["post"]],
    },
  ],
  Docker: [
    {
      key: "image-container",
      text: "What is the difference between a Docker image and a container, and why do teams use Docker?",
      expects: [
        ["image"],
        ["container"],
        ["environment", "consistent", "reproducible", "deploy", "isolat", "dependencies"],
      ],
    },
  ],
  Kubernetes: [
    {
      key: "pods",
      text: "What problem does Kubernetes solve, and what are pods and deployments?",
      expects: [
        ["orchestrat", "scale", "schedule", "manage"],
        ["pod"],
        ["deployment", "replica", "self-heal", "rolling"],
      ],
    },
  ],
  Git: [
    {
      key: "merge-rebase",
      text: "What is the difference between merging and rebasing in Git, and how do you resolve a conflict?",
      expects: [["merge"], ["rebase"], ["conflict", "resolve"], ["history", "branch", "commit"]],
    },
  ],
  AWS: [
    {
      key: "core-services",
      text: "Which AWS services have you used or would you use to host a small web application, and why?",
      expects: [
        ["ec2", "lambda", "ecs", "elastic beanstalk", "amplify"],
        ["s3", "rds", "dynamodb", "database", "storage"],
        ["because", "cost", "scale", "simple", "managed"],
      ],
    },
  ],
  "CI/CD": [
    {
      key: "pipeline",
      text: "What does a CI/CD pipeline do, and what would you put in one for a new project?",
      expects: [
        ["build", "test", "lint"],
        ["deploy", "release", "pipeline"],
        ["automat", "every commit", "pull request", "merge"],
      ],
    },
  ],
  Linux: [
    {
      key: "debugging",
      text: "A service on a Linux server is slow. Which commands or tools would you reach for first, and what would you look at?",
      expects: [
        ["top", "htop", "ps", "free", "df", "iostat", "vmstat"],
        ["cpu", "memory", "disk", "load", "process"],
        ["log", "journalctl", "tail", "grep"],
      ],
    },
  ],
  Pandas: [
    {
      key: "cleaning",
      text: "How would you clean a messy dataset in pandas? Describe the steps you usually take.",
      expects: [
        ["missing", "null", "nan", "dropna", "fillna"],
        ["duplicate", "drop_duplicates"],
        ["type", "dtype", "format", "outlier", "inspect", "describe", "info"],
      ],
    },
  ],
  "Machine Learning": [
    {
      key: "overfitting",
      text: "What is overfitting, how can you tell, and what can you do about it?",
      expects: [
        ["overfit", "memoriz", "too well"],
        ["validation", "test set", "held-out", "cross-validation", "train"],
        ["regulariz", "more data", "simpler", "early stopping", "dropout"],
      ],
    },
    {
      key: "metrics",
      text: "How do you choose an evaluation metric for a classification problem?",
      expects: [
        ["accuracy", "precision", "recall", "f1", "auc"],
        ["imbalance", "imbalanced", "class", "cost", "false positive", "false negative"],
      ],
    },
  ],
  "Data Analysis": [
    {
      key: "approach",
      text: "You are handed a dataset and a vague question. How do you go from there to an answer someone can act on?",
      expects: [
        ["clarify", "question", "stakeholder", "goal"],
        ["clean", "explore", "inspect", "visuali"],
        ["insight", "recommend", "present", "decision", "communicate"],
      ],
    },
  ],
  Excel: [
    {
      key: "lookup",
      text: "How would you combine data from two sheets in Excel, and what could go wrong?",
      expects: [
        ["vlookup", "xlookup", "index", "match", "lookup", "merge"],
        ["duplicate", "mismatch", "missing", "error", "#n/a", "exact"],
      ],
    },
  ],
  "Data Visualization": [
    {
      key: "choosing",
      text: "How do you decide which chart to use, and what makes a chart misleading?",
      expects: [
        ["bar", "line", "scatter", "pie", "histogram", "chart type"],
        ["audience", "message", "compare", "trend", "distribution"],
        ["axis", "scale", "truncat", "misleading", "color"],
      ],
    },
  ],
  "Apache Kafka": [
    {
      key: "topics",
      text: "What is Kafka used for, and how do topics, partitions and consumer groups fit together?",
      expects: [
        ["topic"],
        ["partition"],
        ["consumer", "producer"],
        ["order", "scale", "parallel", "stream", "event"],
      ],
    },
  ],
  Redis: [
    {
      key: "caching",
      text: "How would you use Redis as a cache, and how do you deal with stale data?",
      expects: [
        ["cache", "caching"],
        ["ttl", "expire", "expiry", "invalidate", "invalidation", "evict"],
        ["stale", "consisten"],
      ],
    },
  ],
  MongoDB: [
    {
      key: "document-model",
      text: "When would you choose a document database like MongoDB over a relational one, and what do you give up?",
      expects: [
        ["document", "json", "schema", "flexible"],
        ["relational", "join", "transaction", "consistency"],
        ["because", "when", "depends", "trade-off"],
      ],
    },
  ],
  "Unit Testing": [
    {
      key: "what-to-test",
      text: "What makes a good unit test, and how do you decide what to test?",
      expects: [
        ["test", "assert"],
        ["isolated", "fast", "deterministic", "mock", "independent"],
        ["edge case", "boundary", "behavior", "behaviour", "failure", "regression"],
      ],
    },
  ],
  "Data Structures": [
    {
      key: "hash-map",
      text: "How does a hash map work, and what happens when two keys land in the same bucket?",
      expects: [
        ["hash", "bucket"],
        ["collision", "chain", "probing", "same bucket"],
        ["o(1)", "constant", "average", "lookup", "worst"],
      ],
    },
    {
      key: "stack-queue",
      text: "Explain the difference between a stack and a queue, and give a real use for each.",
      expects: [
        ["stack", "lifo", "last in"],
        ["queue", "fifo", "first in"],
        [
          "example",
          "for instance",
          "undo",
          "browser",
          "scheduling",
          "bfs",
          "breadth",
          "call stack",
        ],
      ],
    },
  ],
  "System Design": [
    {
      key: "url-shortener",
      text: "Design a URL shortener. What are the main parts, and where might it break as it grows?",
      expects: [
        ["id", "hash", "key", "encode", "base62"],
        ["database", "store", "cache"],
        ["scale", "traffic", "load", "replica", "bottleneck"],
        ["redirect", "api", "endpoint"],
      ],
    },
  ],
  Microservices: [
    {
      key: "trade-offs",
      text: "What are the trade-offs between a monolith and microservices?",
      expects: [
        ["monolith"],
        ["microservice", "service"],
        ["deploy", "scale", "independent", "team"],
        ["complex", "latency", "network", "debug", "overhead"],
      ],
    },
  ],
  Agile: [
    {
      key: "scrum",
      text: "How have you worked in an Agile team? Describe what a sprint looked like and your part in it.",
      expects: [
        ["sprint", "scrum", "kanban", "standup", "stand-up"],
        ["planning", "review", "retrospective", "backlog", "story"],
        ["i ", "my ", "we "],
      ],
    },
  ],
};

/** Behavioral questions for anyone. The expected groups follow the STAR shape lightly. */
export const BEHAVIORAL_QUESTIONS: BankQuestion[] = [
  {
    key: "challenge",
    text: "Tell me about a time you faced a difficult problem. What did you do, and what happened?",
    expects: [
      ["problem", "challenge", "difficult", "stuck"],
      ["i ", "my "],
      ["result", "outcome", "solved", "fixed", "learned"],
    ],
  },
  {
    key: "teamwork",
    text: "Describe a time you worked in a team and something did not go smoothly. How did you handle it?",
    expects: [
      ["team", "teammate", "group", "we "],
      ["disagree", "conflict", "delay", "miss", "misunderstand", "problem"],
      ["talk", "discuss", "agree", "resolve", "listen", "learned"],
    ],
  },
  {
    key: "deadline",
    text: "Tell me about a time you had too much to do in too little time. How did you decide what to do first?",
    expects: [
      ["deadline", "time", "priorit"],
      ["decide", "plan", "list", "order", "ask", "scope"],
      ["result", "delivered", "finished", "learned"],
    ],
  },
  {
    key: "mistake",
    text: "Tell me about a mistake you made. What did you do about it afterwards?",
    expects: [
      ["mistake", "wrong", "error", "bug", "missed"],
      ["fix", "told", "apolog", "owned", "changed", "process"],
      ["learned", "now", "since", "next time"],
    ],
  },
  {
    key: "learning",
    text: "Describe something technical you taught yourself recently. How did you go about it?",
    expects: [
      ["learn", "taught", "tutorial", "course", "docs", "documentation", "read"],
      ["built", "practice", "project", "tried"],
      ["result", "now", "able", "used"],
    ],
  },
  {
    key: "feedback",
    text: "Tell me about feedback that was hard to hear. What did you change because of it?",
    expects: [
      ["feedback", "review", "told me", "suggest"],
      ["changed", "improved", "adjust", "practice", "started", "stopped"],
      ["result", "since", "better", "now"],
    ],
  },
  {
    key: "initiative",
    text: "Give an example of something you did that nobody asked you to do. Why did you do it?",
    expects: [
      ["noticed", "saw", "idea", "initiative", "volunteer", "on my own"],
      ["built", "started", "proposed", "wrote", "organi"],
      ["result", "impact", "helped", "used", "saved"],
    ],
  },
  {
    key: "explain",
    text: "Tell me about a time you had to explain something technical to someone who was not technical.",
    expects: [
      ["explain", "simple", "analogy", "example", "walk"],
      ["audience", "they", "understand", "non-technical", "stakeholder", "manager", "friend"],
      ["result", "understood", "agreed", "feedback"],
    ],
  },
];

/** Asked early in most processes. `{company}` and `{title}` come from the posting. */
export const MOTIVATION_QUESTIONS: BankQuestion[] = [
  {
    key: "why-company",
    text: "Why do you want to work at {company}?",
    expects: [
      ["company", "team", "product", "mission", "work on", "problem"],
      ["because", "interested", "excited", "fit", "skills", "experience"],
    ],
  },
  {
    key: "why-role",
    text: "Why are you interested in the {title} role?",
    expects: [
      ["role", "work", "responsibilit", "skills", "experience"],
      ["because", "interested", "enjoy", "fit", "goal", "career"],
    ],
  },
  {
    key: "tell-me",
    text: "Tell me about yourself, in a minute or two.",
    expects: [
      ["i am", "i'm", "studied", "student", "graduat", "worked", "built"],
      ["project", "experience", "skills", "learned"],
      ["looking", "interested", "next", "role", "want"],
    ],
  },
];

/** Questions the person can ask the interviewer. Used for the prep checklist. */
export const QUESTIONS_TO_ASK: string[] = [
  "What does a typical first month look like for someone in this role?",
  "How does the team decide what to work on, and how are priorities changed?",
  "What would success look like for this role after six months?",
  "How does the team handle code review and feedback?",
  "What are the biggest challenges the team is working on right now?",
];
