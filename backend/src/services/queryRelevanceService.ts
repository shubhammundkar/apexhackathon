import { RepositoryMetadata } from '@codebase-explainer/shared';

export const REJECTION_MESSAGE =
  "I'm designed to help you understand and analyze the current codebase. Please ask a question about its code, architecture, dependencies, bugs, or implementation.";

export interface QueryRelevanceContext {
  question: string;
  filePath?: string;
  repoMetadata?: RepositoryMetadata;
  allFilePaths?: string[];
  recentHistory?: { question: string }[];
}

export interface RelevanceClassification {
  isRelevant: boolean;
  reason:
    | 'valid_code_intent'
    | 'file_path_scoped'
    | 'repo_entity_match'
    | 'conversational_follow_up'
    | 'unrelated_irrelevant'
    | 'ambiguous_fallback';
  confidence: number;
}

export class QueryRelevanceService {
  // Common programming file extensions
  private static readonly FILE_EXTENSION_REGEX =
    /\.(ts|tsx|js|jsx|mjs|cjs|py|json|yaml|yml|md|css|scss|sass|html|go|rs|java|c|cpp|h|hpp|sql|sh|bash|env|toml|dockerfile|lock|vue|svelte|graphql|proto)\b/i;

  // Short follow-up phrases that make sense in a developer Q&A session
  private static readonly FOLLOW_UP_REGEX =
    /^(why(\s+is\s+that)?|how(\s+so)?|how(\s+does\s+it\s+work)?|what\s+happens\s+next|can\s+you\s+(simplify|elaborate|clarify|explain(\s+more)?)|give\s+an\s+example|show\s+(me\s+)?code|what\s+else|where\s+is\s+it\s+(defined|called|used)|which\s+file|continue|elaborate|simplify|more\s+details|explain\s+(this|that|it|more)|tell\s+me\s+more|what\s+about\s+(this|that)|how\s+to\s+fix\s+(it|this)|can\s+we\s+optimize\s+(this|it))\??$/i;

  // Explicit non-coding categories that should be immediately rejected
  private static readonly IRRELEVANT_PATTERNS: RegExp[] = [
    // Fast food, restaurants, shops, navigation, physical places
    /\b(kfc|mcdonald'?s?|subway|domino'?s?|starbucks|burger\s*king|pizza\s*hut|taco\s*bell|wendy'?s?|chipotle|dunkin|popeyes)\b/i,
    /\b(restaurant|restaurants|cafe|cafes|hotel|hotels|food|dinner|lunch|breakfast|grocer|groceries|supermarket|mall|shop|stores?|bar|pub|gas\s*station|petrol\s*pump|hospital|pharmacy|clinic|dentist|atm|bank)\s+(near|around|nearby|close\s*to|in\s+my\s+area|in\s+town)\b/i,
    /\b(near\s+me|nearest\s+[a-z]+|nearby\s+[a-z]+|directions?\s+to|how\s+to\s+drive\s+to|flight\s+to|train\s+to|bus\s+to|traffic\s+in)\b/i,

    // Real-time physical weather & environmental forecasts
    /\b(what'?s\s+the\s+weather|weather\s+(today|tomorrow|in|forecast)|temperature\s+(today|outside|in)|will\s+it\s+rain|air\s*quality\s+index)\b/i,

    // Pop culture, entertainment, celebrities, sports scores
    /\b(movie|movies|film|cinema|netflix|actor|actress|celebrity|hollywood|bollywood|singer|song|album|spotify)\b/i,
    /\b(cricket|football|soccer|nba|nfl|world\s*cup|match\s*score|who\s*won\s*the\s*(game|match))\b/i,
    /\b(horoscope|astrology|zodiac|tarot)\b/i,

    // Jokes, poetry, dating, personal therapy / casual romance
    /\b(tell\s+me\s+a\s+joke|make\s+me\s+laugh|funny\s+pun|riddle)\b/i,
    /\b(write\s+(me\s+)?a\s+poem|love\s+letter|dating\s+advice|who\s+is\s+your\s+(girlfriend|boyfriend|crush)|do\s+you\s+love\s+me)\b/i,
    /\b(meaning\s+of\s+life|are\s+you\s+human|do\s+you\s+have\s+feelings|how\s+are\s+you\s+feeling\s+today)\b/i,

    // General world history, politics, general trivia (cooking, medical, trivia)
    /\b(who\s+was|who\s+is)\s+(napoleon|caesar|cleopatra|einstein|newton|lincoln|gandhi|the\s+president|the\s+prime\s+minister)\b/i,
    /\b(capital\s+of\s+[a-z]+|population\s+of\s+[a-z]+|currency\s+of\s+[a-z]+)\b/i,
    /\b(how\s+to\s+(bake|cook|make)\s+(a\s+)?(cake|pizza|bread|pasta|curry|cookie|soup|sandwich))\b/i,
    /\b(recipe\s+for\s+[a-z]+)\b/i,
    /\b(symptoms\s+of|treatment\s+for|medical\s+advice|cure\s+for|dosage\s+of)\b/i,
    /\b(buy\s+(cheap\s+)?(shoes|clothes|iphone|laptop|tickets?)|discount\s+coupons?)\b/i,
  ];

  // Positive code and engineering intent indicators
  private static readonly CODE_INTENT_REGEX =
    /\b(code|codebase|repo|repository|project|commit|branch|pull\s*request|pr|file|files|folder|directory|path|entrypoint|entry\s*point|src|source|lib|readme|docs?|documentation|license|author|changelog|workspace)\b|\b(app|apps|application|system|software|program|tool|service|server|client|microservice|architecture|pattern|data\s*flow|lifecycle|pipeline|mvc|dependency|dependencies|stack|tech\s*stack|framework|library|layer|module|packages?|monorepo)\b|\b(function|method|class|constructor|destructor|variable|constant|param|parameter|argument|type|interface|enum|struct|trait|generic|import|export|require|namespace|hook|component|props?|state|context|store|dispatch|reducer|effect|ref|dom|template|view)\b|\b(algorithm|logic|loop|array|list|map|set|dict|dictionary|hash|stack|queue|tree|graph|binary\s*tree|recursion|iterate|parse|format|convert|transform|validate|validation|schema|regex|sanitiz(e|ation))\b|\b(async|await|promise|callback|closure|thread|process|worker|concurrency|parallel|event|stream|websocket|socket|poll|sse|fetch|axios|ajax|rpc|grpc)\b|\b(api|rest|restful|graphql|endpoint|route|router|routing|controller|handler|middleware|payload|header|request|response|status\s*code|crud|auth|authentication|authorization|token|jwt|session|cookie|cors|helmet)\b|\b(database|db|sql|nosql|mongodb|postgres|postgresql|sqlite|mysql|redis|prisma|mongoose|orm|migration|query|queries|mutation|table|column|document|collection|index|indexing)\b|\b(frontend|backend|ui|ux|tailwind|css|scss|sass|html|jsx|tsx|vue|svelte|angular|react|next|vite|bundler)\b|\b(bug|error|exception|fix|fixing|debug|debugging|crash|traceback|issue|defect|fail|failure|broken|syntax\s*error|type\s*error|unhandled|null\s*pointer|undefined|warn|warning|panic|stacktrace)\b|\b(security|vulnerability|exploit|injection|xss|csrf|ssrf|sanitize|audit|credentials?|secret|leak|performance|optimize|optimization|memory\s*leak|profil(e|ing)|maintainability|clean\s*code|refactor|refactoring)\b|\b(test|tests|testing|vitest|jest|mocha|chai|cypress|playwright|unit\s*test|integration\s*test|mock|stub|spy|coverage|assert|assertion)\b|\b(build|compile|bundle|webpack|vite|rollup|turbopack|esbuild|docker|dockerfile|container|deploy|deployment|ci\/cd|pipeline|github\s*actions)\b|\b(npm|yarn|pnpm|pip|cargo|gem|composer|install|setup|run|start|dev|config|configuration|\.env|env|script)\b/i;

  // Syntactic programming markers: e.g. foo(), FooBar, my_var, { foo }, =>
  private static readonly CODE_SYNTAX_MARKERS = [
    /\b[a-z0-9]+[A-Z][a-zA-Z0-9]+\b/, // camelCase or PascalCase (e.g. getUserById, AuthService)
    /\b[a-z0-9]+_[a-z0-9_]+\b/, // snake_case (e.g. parse_repo, user_id)
    /[a-zA-Z0-9_]+\(\)/, // functionCall()
    /=>/, // arrow function
    /\{[\s\S]*\}/, // object literal or block
    /<\/?[a-zA-Z0-9]+>/, // JSX/HTML tag e.g. <Component />
    /`[^`]+`/, // backtick code span
    /===|!==|->|::/, // operators
  ];

  /**
   * Classifies whether a user query is relevant to the repository
   */
  public classify(context: QueryRelevanceContext): RelevanceClassification {
    const rawQuestion = (context.question || '').trim();
    if (!rawQuestion) {
      return { isRelevant: false, reason: 'ambiguous_fallback', confidence: 1.0 };
    }

    const cleanQuestion = rawQuestion.toLowerCase();

    // 1. Check for valid short conversational follow-ups
    if (QueryRelevanceService.FOLLOW_UP_REGEX.test(rawQuestion.trim())) {
      return { isRelevant: true, reason: 'conversational_follow_up', confidence: 0.95 };
    }

    // 2. Check if scoped to a specific file (user viewing a file in CodeViewer or scoping QA)
    if (context.filePath && context.filePath.trim().length > 0) {
      // If scoped to a file, questions like "what does this do", "explain line 10", "is this safe" are valid
      if (
        /\b(this|here|it|line|function|class|method|code|why|how|what|audit|check|review|bug|error|safe)\b/i.test(
          cleanQuestion
        )
      ) {
        return { isRelevant: true, reason: 'file_path_scoped', confidence: 0.98 };
      }
    }

    // 3. Check for file extension mentions (e.g. "what is in main.py", "explain index.ts")
    if (QueryRelevanceService.FILE_EXTENSION_REGEX.test(rawQuestion)) {
      return { isRelevant: true, reason: 'valid_code_intent', confidence: 0.95 };
    }

    // 4. Check for code syntax markers (camelCase identifiers, snake_case, function calls)
    for (const marker of QueryRelevanceService.CODE_SYNTAX_MARKERS) {
      if (marker.test(rawQuestion)) {
        return { isRelevant: true, reason: 'valid_code_intent', confidence: 0.92 };
      }
    }

    // 5. Check if query matches positive programming / architectural keywords
    const hasCodeIntent = QueryRelevanceService.CODE_INTENT_REGEX.test(rawQuestion);

    // 6. Check for explicit irrelevant patterns (e.g., "Where is KFC near me?", "What's the weather?")
    for (const pattern of QueryRelevanceService.IRRELEVANT_PATTERNS) {
      if (pattern.test(cleanQuestion)) {
        // If an irrelevant pattern matched, check if it's genuinely about code (e.g. "how to build a weather app in react")
        if (!hasCodeIntent) {
          return { isRelevant: false, reason: 'unrelated_irrelevant', confidence: 0.99 };
        }
      }
    }

    if (hasCodeIntent) {
      return { isRelevant: true, reason: 'valid_code_intent', confidence: 0.9 };
    }

    // 7. Check if query matches actual repository file paths or directory names
    if (context.allFilePaths && context.allFilePaths.length > 0) {
      const words = cleanQuestion.split(/[^a-z0-9_.-]+/).filter((w) => w.length >= 3);
      for (const word of words) {
        const matchesRepoFile = context.allFilePaths.some((p) =>
          p.toLowerCase().includes(word)
        );
        if (matchesRepoFile) {
          return { isRelevant: true, reason: 'repo_entity_match', confidence: 0.88 };
        }
      }
    }

    // 8. Check if query mentions repository metadata (repo name, description words, topics)
    if (context.repoMetadata?.name) {
      const repoNameLower = context.repoMetadata.name.toLowerCase();
      if (cleanQuestion.includes(repoNameLower)) {
        return { isRelevant: true, reason: 'repo_entity_match', confidence: 0.85 };
      }
    }

    // 9. Conservative Fallback: If no code or repository intent was detected, reject to save LLM tokens
    return { isRelevant: false, reason: 'ambiguous_fallback', confidence: 0.8 };
  }
}

export const queryRelevanceService = new QueryRelevanceService();
