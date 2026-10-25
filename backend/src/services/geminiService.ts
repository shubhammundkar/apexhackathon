import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  RepositoryMetadata,
  RepositoryOverview,
  ArchitectureAnalysis,
  ExecutionFlow,
  CodeFinding,
  SearchCitation,
  QAResponse,
  SourceFile,
} from '@codebase-explainer/shared';
import { ParsedProjectManifest } from './parserService.js';
import { selectArchitectureContext } from './contextSelectionService.js';

export interface AnalysisGenerationResult {
  overview: RepositoryOverview;
  architecture: ArchitectureAnalysis;
  executionFlows: ExecutionFlow[];
  findings: CodeFinding[];
  modelUsed: string;
}

/**
 * Sanitizes any error message to ensure API keys, tokens, or credentials are never leaked in logs or errors
 */
function sanitizeError(err: any): string {
  const msg = err?.message || String(err || 'Unknown error');
  return msg
    .replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
}

/**
 * Formats retrieved SearchCitations into an LLM evidence block.
 * Each block shows "[EVIDENCE #n] path (lines a-b) kind symbolName"
 * and every code line is prefixed with its original file line number.
 */
export function formatEvidence(citations: SearchCitation[]): string {
  if (!citations || citations.length === 0) {
    return 'No direct code matches found in retrieved files.';
  }

  return citations
    .map((c, i) => {
      const kindStr = c.kind ? ` ${c.kind}` : '';
      const symbolStr = c.symbolName ? ` ${c.symbolName}` : '';
      const lines = c.snippet.split('\n');
      const numberedSnippet = lines
        .map((line, lineIdx) => `${c.startLine + lineIdx} | ${line}`)
        .join('\n');

      return `[EVIDENCE #${i + 1}] ${c.filePath} (lines ${c.startLine}-${c.endLine})${kindStr}${symbolStr}\n\`\`\`\n${numberedSnippet}\n\`\`\``;
    })
    .join('\n\n');
}

export class GeminiService {
  private defaultApiKey: string;
  private defaultModel: string;
  private readonly fallbackModels = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
  ];

  constructor(apiKey: string = '', model: string = 'gemini-3.5-flash') {
    this.defaultApiKey = apiKey.trim();
    this.defaultModel = model.trim();
  }

  private getClient(overrideKey?: string): { client: GoogleGenerativeAI; modelName: string } {
    const key = (overrideKey && overrideKey.trim().length > 5) ? overrideKey.trim() : this.defaultApiKey;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not configured. Please provide an API key in your server .env or in the request.');
    }
    return {
      client: new GoogleGenerativeAI(key),
      modelName: this.defaultModel || 'gemini-3.5-flash',
    };
  }

  public isConfigured(overrideKey?: string): boolean {
    const key = (overrideKey && overrideKey.trim().length > 5) ? overrideKey.trim() : this.defaultApiKey;
    return Boolean(key && key.length > 5);
  }

  /**
   * Generates a grounded full repository analysis using Gemini
   */
  public async generateRepositoryAnalysis(
    metadata: RepositoryMetadata,
    manifest: ParsedProjectManifest,
    files: SourceFile[],
    userApiKey?: string,
    modelName?: string
  ): Promise<AnalysisGenerationResult> {
    const { client } = this.getClient(userApiKey);
    const chosenModel = modelName || this.defaultModel || 'gemini-3.5-flash';
    const modelsToTry = [chosenModel, ...this.fallbackModels].filter(
      (m, idx, arr) => arr.indexOf(m) === idx
    );

    // Select high-importance files and structure using contextSelectionService
    const { selectedFiles, pathsListFormatted } = selectArchitectureContext(files, manifest);

    const contextFiles = selectedFiles.map((f) => {
      return `--- FILE: ${f.path} (${f.language}) ---\n${f.content}\n`;
    }).join('\n');

    const prompt = `
You are an expert software architect and security auditor.
Analyze the following real repository and generate a strictly grounded, accurate technical breakdown.
DO NOT hallucinate files, functions, or dependencies that are not in the provided evidence.

REPOSITORY METADATA:
- Name: ${metadata.fullName}
- Description: ${metadata.description || 'N/A'}
- Primary Language: ${metadata.primaryLanguage || 'Unknown'}
- Stars: ${metadata.stars}
- Detected Entry Points: ${JSON.stringify(manifest.entryPoints)}
- Detected Tech Stack: ${JSON.stringify(manifest.stack)}
- Package Manager: ${manifest.packageManager || 'None'}
- Scripts: ${JSON.stringify(manifest.scripts)}

REPOSITORY STRUCTURE (ALL INDEXED FILES):
${pathsListFormatted}

SOURCE CODE EXTRACTS (${selectedFiles.length} key files):
${contextFiles}

Respond ONLY with a valid JSON object matching this exact schema:
{
  "overview": {
    "projectName": "${metadata.name}",
    "tagline": "One-line punchy summary of what this repository does",
    "problemSolved": "In-depth, multi-paragraph explanation (at least 2-3 detailed paragraphs) of the specific real-world problem and domain challenges this project solves. Address: 1) What specific user pain points, domain traps, or operational inefficiencies exist in this domain; 2) Why naive or traditional alternatives fail; 3) How this specific codebase technically and algorithmically addresses the problem with concrete references to its modules, algorithms, and business logic.",
    "detailedSummary": "Comprehensive, multi-paragraph technical summary (at least 3-4 rich paragraphs) of the codebase. Provide: 1) High-level system purpose, operational context, and architectural pattern; 2) Deep dive into core modules, calculations, and data processing pipelines; 3) Persistence, data structures, and state management mechanisms; 4) User interface, client-server communication, and runtime execution lifecycle.",
    "quickStartGuide": {
      "prerequisites": ["List of tools, runtimes, e.g. Node 18+, Python 3.10+"],
      "installCommands": ["Commands to install dependencies based on detected package manager/scripts"],
      "runCommands": ["Commands to build and run the project"],
      "envVariablesRequired": ["Environment variables inferred from code or config files"]
    },
    "missingOrAmbiguousInfo": ["Any missing documentation, secrets, or ambiguous setup steps"]
  },
  "architecture": {
    "pattern": "Architecture style (e.g. Monolithic REST API, SPA + Backend, CLI Tool, Event-driven)",
    "description": "Explanation of component relationships, architectural layers, and boundary separation",
    "layers": [
      {
        "name": "Layer Name",
        "type": "frontend" | "backend" | "database" | "api" | "auth" | "worker" | "shared",
        "description": "Responsibility of this layer",
        "files": ["file1.ts", "file2.ts"],
        "dependencies": ["other layer names"]
      }
    ],
    "mermaidDiagram": "graph TD\\n  subgraph Frontend [\"Frontend / View Layer\"]\\n    V[\"Views / XML Templates / Components\"] --> C[\"Client Scripts / API Caller\"]\\n  end\\n  subgraph Routing [\"Routing & Gateway Layer\"]\\n    R[\"Web Dispatcher / Router\"] --> AUTH[\"Session & Auth Guards\"]\\n  end\\n  subgraph Logic [\"Controllers & Services\"]\\n    CTRL[\"Route Controllers / Handlers\"] --> SVC[\"Domain Services & Business Rules\"]\\n  end\\n  subgraph Persistence [\"Data Access & Database\"]\\n    ORM[\"ORM Models & Query Builder\"] --> DB[(\"Database Store\")]\\n  end\\n  C -- \"1. User Action / Request\" --> R\\n  AUTH --> CTRL\\n  CTRL --> SVC\\n  SVC --> ORM\\n  ORM -- \"2. Query / Write\" --> DB\\n  DB -- \"3. Data Records\" --> ORM\\n  ORM --> SVC\\n  SVC --> CTRL\\n  CTRL -- \"4. Response Data / View\" --> V\\n",
    "dataFlowDescription": "Detailed trace of how data flows between layers"
  },
  "executionFlows": [
    {
      "name": "Main Execution Flow",
      "trigger": "Application start / HTTP Request",
      "description": "Step-by-step description of entrypoint initialization",
      "steps": [
        {
          "step": 1,
          "layer": "backend",
          "file": "path/to/entry.ts",
          "functionOrRoute": "main()",
          "action": "Description of action",
          "isConfirmed": true,
          "notes": "Verified from file"
        }
      ]
    }
  ],
  "findings": [
    {
      "id": "finding-1",
      "category": "bug" | "security" | "code_smell" | "architecture" | "missing_test" | "maintainability",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "title": "Clear concise title",
      "description": "Detailed explanation of the issue backed by actual code",
      "filePath": "path/to/file.ts",
      "startLine": 1,
      "endLine": 10,
      "codeSnippet": "code extract",
      "isConfirmed": true,
      "impact": "Potential security or operational impact",
      "remediation": "Exact suggested fix"
    }
  ]
}

CRITICAL ARCHITECTURE DIAGRAM INSTRUCTIONS:
- The "mermaidDiagram" MUST be a detailed, professional, multi-tier architectural flowchart (using 'graph TD' or 'graph LR') explaining the complete end-to-end data flow from the frontend view to the backend and database.
- DO NOT generate a trivial 2 or 3-box diagram (avoid simple "Frontend -> Backend -> Database").
- Structure the diagram into logical subgraphs representing the real layers discovered in the code:
  1. Frontend / View Layer: Views, XML/QWeb/HTML templates, React/Vue/JS components, forms, client-side state, user actions.
  2. Network / API Gateway Layer: HTTP / REST / JSON-RPC endpoints, routing, middleware, authentication guards.
  3. Controller & Application Logic Layer: Controllers, route handlers, dispatchers, payload parsing, input validation.
  4. Domain & Service Layer: Business logic modules, helper services, calculation routines, state managers.
  5. Data Access & Persistence Layer: ORM models, record sets, SQL / NoSQL queries, database connections (e.g. PostgreSQL, SQLite, MongoDB).
- Explicitly trace the complete data flow using labeled arrows showing how user input travels down to storage and how data returns back to update the view.
- Ensure the mermaidDiagram is valid Mermaid syntax: avoid unescaped special characters, parentheses, or brackets in node labels (always wrap node text in double quotes, e.g. ID[\"Component Name\"]).
DO NOT wrap in markdown backticks other than valid JSON. Return pure JSON.
`;

    let lastError: any = null;
    for (const modelToUse of modelsToTry) {
      try {
        const model = client.getGenerativeModel({
          model: modelToUse,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        });

        const response = await model.generateContent(prompt);
        const text = response.response.text();
        const parsed = JSON.parse(text);

        if (parsed.architecture && typeof parsed.architecture.mermaidDiagram === 'string') {
          let cleanDiagram = parsed.architecture.mermaidDiagram.trim();
          if (cleanDiagram.startsWith('```mermaid')) {
            cleanDiagram = cleanDiagram.replace(/^```mermaid\s*/i, '').replace(/```\s*$/i, '').trim();
          } else if (cleanDiagram.startsWith('```')) {
            cleanDiagram = cleanDiagram.replace(/^```\s*/, '').replace(/```\s*$/i, '').trim();
          }
          parsed.architecture.mermaidDiagram = cleanDiagram;
        }

        return {
          overview: {
            ...parsed.overview,
            detectedStack: manifest.stack,
            entryPoints: manifest.entryPoints,
          },
          architecture: parsed.architecture,
          executionFlows: parsed.executionFlows || [],
          findings: parsed.findings || [],
          modelUsed: modelToUse,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Model ${modelToUse} failed in generateRepositoryAnalysis: ${sanitizeError(err)}. Trying fallback...`);
      }
    }

    throw new Error(`Gemini API Error: ${sanitizeError(lastError)}`);
  }

  /**
   * Answers natural language questions grounded strictly in retrieved source citations
   */
  public async answerQuestion(
    question: string,
    citations: SearchCitation[],
    metadata: RepositoryMetadata,
    filePathFilter?: string,
    userApiKey?: string,
    modelName?: string,
    extraContext?: {
      detectedStack?: any[];
      entryPoints?: any[];
      architecturePattern?: string;
      architectureDescription?: string;
    }
  ): Promise<QAResponse> {
    const { client } = this.getClient(userApiKey);
    const chosenModel = modelName || this.defaultModel || 'gemini-3.5-flash';
    const modelsToTry = [chosenModel, ...this.fallbackModels].filter(
      (m, idx, arr) => arr.indexOf(m) === idx
    );

    const evidenceText = formatEvidence(citations);

    const prompt = `
You are a senior codebase explainer. The user is asking a question about the repository "${metadata.fullName}".
Answer the question based STRICTLY on the retrieved evidence below.

QUESTION:
${question}

${filePathFilter ? `NOTE: The user is specifically focused on file: "${filePathFilter}"` : ''}

${extraContext?.detectedStack && extraContext.detectedStack.length > 0 ? `PROJECT STACK:
Stack: ${extraContext.detectedStack.map((s: any) => s.name).join(', ')}` : ''}
${extraContext?.entryPoints && extraContext.entryPoints.length > 0 ? `ENTRY POINTS:
${extraContext.entryPoints.map((ep: any) => `${ep.path} (${ep.type || 'entry'})`).join(', ')}` : ''}
${extraContext?.architecturePattern ? `ARCHITECTURE PATTERN: ${extraContext.architecturePattern}` : ''}
${extraContext?.architectureDescription ? `ARCHITECTURE DESCRIPTION:
${extraContext.architectureDescription}` : ''}

RETRIEVED CODE EVIDENCE:
${evidenceText}

RULES:
1. Always ground your explanations in the provided evidence.
2. When referencing code, cite the exact file path and line numbers using the format: [path/to/file:startLine-endLine].
3. Cite only line ranges that lie inside the evidence blocks shown.
4. If the evidence does not contain enough information to answer definitively, state honestly what is known and what cannot be determined from the retrieved files.
5. Response formatting & organization:
   - Provide a short, direct answer first.
   - Explicitly highlight key factors, core technologies, and architectural decisions using bold text (e.g. **Key Factor:** or **ConceptName**) so crucial takeaways stand out immediately.
   - Use clear subheadings (e.g. ### Heading) only when needed to organize distinct topics.
   - Use concise bullet points for multiple items and numbered steps for procedures or sequential flows.
   - Wrap code, variables, and file names in inline backticks (e.g. \`main.ts\`, \`startServer()\`).
   - Use fenced code blocks with language tags (e.g. \`\`\`typescript ... \`\`\`) for all code snippets.
   - Include a short summary only when useful.
   - Do not force headings or bullet points into every response; simple questions should receive simple, direct answers.
6. If the user asks for line-by-line breakdown or feature contribution guide, refer directly to the actual files and functions shown above.
7. ARCHITECTURE & MERMAID DIAGRAM INSTRUCTIONS:
   - When the user asks for an "architecture diagram", "flowchart", "diagram", "component graph", "visual flow", or asks how a specific file, component, backend, frontend, or feature interacts:
   - You MUST generate a clear, professional, valid Mermaid.js diagram inside a \`\`\`mermaid ... \`\`\` code block.
   - Diagram Structure & Quality:
     * Use 'graph TD' (top-down) or 'graph LR' (left-to-right) for component architectures, or 'sequenceDiagram' for request/lifecycle flows.
     * When diagramming a SPECIFIC FILE:
       - Show external consumers/callers that import or invoke this file.
       - Show the internal classes, methods, or functions inside this file and how they process data.
       - Show downstream services, utilities, models, or APIs this file calls or writes to.
     * When diagramming BACKEND, FRONTEND, or the WHOLE SYSTEM:
       - Use clean logical subgraphs: e.g. subgraph "Frontend Layer", subgraph "API Routes / Controllers", subgraph "Core Services & Business Logic", subgraph "Store / Database / Cache".
     * Strict Mermaid Syntax Rules:
       - Every node text MUST be enclosed in double quotes: A["Node Title (details)"] — NEVER put raw parentheses or brackets directly in node IDs or labels without quotes!
       - Keep node IDs simple alphanumeric: e.g. ClientUI["React App (LandingPage.tsx)"].
       - Use descriptive labels on arrows: e.g. -->|"HTTP POST /analyze"|.
     * Place this diagram prominently inside the "### 🟡 Low-Level Technical" section (or right at the start of your technical explanation) so it renders as an interactive visual diagram in the UI.
     * Accompany the diagram with a clear explanation of each node and connection.

STRUCTURE YOUR ANSWER IN 3 TIERS using these exact markdown headings so the UI can provide interactive perspective tabs:

### 🟢 Beginner Overview
[Start with a short, direct answer in plain English with real-world analogies. Avoid jargon so anyone can understand what this does and why.]

### 🟡 Low-Level Technical
[Explain the software architecture, component relationships, function flows, data transformations, and system roles using concise bullet points, flows, and Mermaid diagrams where relevant.]

### 🟣 Deep Technical & Implementation
[Provide deep code-level walkthrough, exact function mechanics, citations to [file:startLine-endLine], edge cases, and performance/security implications with code blocks.]
`;

    let lastError: any = null;
    for (const modelToUse of modelsToTry) {
      try {
        const model = client.getGenerativeModel({
          model: modelToUse,
          generationConfig: { temperature: 0.3 },
        });

        const response = await model.generateContent(prompt);
        const answer = response.response.text();

        return {
          question,
          answer,
          citations,
          modelUsed: modelToUse,
          answeredAt: new Date().toISOString(),
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Model ${modelToUse} failed in answerQuestion: ${sanitizeError(err)}. Trying fallback...`);
      }
    }

    throw new Error(`Gemini Q&A Error: ${sanitizeError(lastError)}`);
  }

  /**
   * Answers questions using real-time streaming tokens via generateContentStream
   */
  public async answerQuestionStream(
    question: string,
    citations: SearchCitation[],
    metadata: RepositoryMetadata,
    onChunk: (chunk: string) => void,
    filePathFilter?: string,
    userApiKey?: string,
    modelName?: string,
    extraContext?: {
      detectedStack?: any[];
      entryPoints?: any[];
      architecturePattern?: string;
      architectureDescription?: string;
    }
  ): Promise<QAResponse> {
    const { client } = this.getClient(userApiKey);
    const chosenModel = modelName || this.defaultModel || 'gemini-3.5-flash';
    const modelsToTry = [chosenModel, ...this.fallbackModels].filter(
      (m, idx, arr) => arr.indexOf(m) === idx
    );

    const evidenceText = formatEvidence(citations);

    const prompt = `
You are a senior codebase explainer. The user is asking a question about the repository "${metadata.fullName}".
Answer the question based STRICTLY on the retrieved evidence below.

QUESTION:
${question}

${filePathFilter ? `NOTE: The user is specifically focused on file: "${filePathFilter}"` : ''}

${extraContext?.detectedStack && extraContext.detectedStack.length > 0 ? `PROJECT STACK:
Stack: ${extraContext.detectedStack.map((s: any) => s.name).join(', ')}` : ''}
${extraContext?.entryPoints && extraContext.entryPoints.length > 0 ? `ENTRY POINTS:
${extraContext.entryPoints.map((ep: any) => `${ep.path} (${ep.type || 'entry'})`).join(', ')}` : ''}
${extraContext?.architecturePattern ? `ARCHITECTURE PATTERN: ${extraContext.architecturePattern}` : ''}
${extraContext?.architectureDescription ? `ARCHITECTURE DESCRIPTION:
${extraContext.architectureDescription}` : ''}

RETRIEVED CODE EVIDENCE:
${evidenceText}

RULES:
1. Always ground your explanations in the provided evidence.
2. When referencing code, cite the exact file path and line numbers using the format: [path/to/file:startLine-endLine].
3. Cite only line ranges that lie inside the evidence blocks shown.
4. If the evidence does not contain enough information to answer definitively, state honestly what is known and what cannot be determined from the retrieved files.
5. Response formatting & organization:
   - Provide a short, direct answer first.
   - Explicitly highlight key factors, core technologies, and architectural decisions using bold text (e.g. **Key Factor:** or **ConceptName**) so crucial takeaways stand out immediately.
   - Use clear subheadings (e.g. ### Heading) only when needed to organize distinct topics.
   - Use concise bullet points for multiple items and numbered steps for procedures or sequential flows.
   - Wrap code, variables, and file names in inline backticks (e.g. \`main.ts\`, \`startServer()\`).
   - Use fenced code blocks with language tags (e.g. \`\`\`typescript ... \`\`\`) for all code snippets.
   - Include a short summary only when useful.
   - Do not force headings or bullet points into every response; simple questions should receive simple, direct answers.
6. If the user asks for line-by-line breakdown or feature contribution guide, refer directly to the actual files and functions shown above.
7. ARCHITECTURE & MERMAID DIAGRAM INSTRUCTIONS:
   - When the user asks for an "architecture diagram", "flowchart", "diagram", "component graph", "visual flow", or asks how a specific file, component, backend, frontend, or feature interacts:
   - You MUST generate a clear, professional, valid Mermaid.js diagram inside a \`\`\`mermaid ... \`\`\` code block.
   - Diagram Structure & Quality:
     * Use 'graph TD' (top-down) or 'graph LR' (left-to-right) for component architectures, or 'sequenceDiagram' for request/lifecycle flows.
     * When diagramming a SPECIFIC FILE:
       - Show external consumers/callers that import or invoke this file.
       - Show the internal classes, methods, or functions inside this file and how they process data.
       - Show downstream services, utilities, models, or APIs this file calls or writes to.
     * When diagramming BACKEND, FRONTEND, or the WHOLE SYSTEM:
       - Use clean logical subgraphs: e.g. subgraph "Frontend Layer", subgraph "API Routes / Controllers", subgraph "Core Services & Business Logic", subgraph "Store / Database / Cache".
     * Strict Mermaid Syntax Rules:
       - Every node text MUST be enclosed in double quotes: A["Node Title (details)"] — NEVER put raw parentheses or brackets directly in node IDs or labels without quotes!
       - Keep node IDs simple alphanumeric: e.g. ClientUI["React App (LandingPage.tsx)"].
       - Use descriptive labels on arrows: e.g. -->|"HTTP POST /analyze"|.
     * Place this diagram prominently inside the "### 🟡 Low-Level Technical" section (or right at the start of your technical explanation) so it renders as an interactive visual diagram in the UI.
     * Accompany the diagram with a clear explanation of each node and connection.

STRUCTURE YOUR ANSWER IN 3 TIERS using these exact markdown headings so the UI can provide interactive perspective tabs:

### 🟢 Beginner Overview
[Start with a short, direct answer in plain English with real-world analogies. Avoid jargon so anyone can understand what this does and why.]

### 🟡 Low-Level Technical
[Explain the software architecture, component relationships, function flows, data transformations, and system roles using concise bullet points, flows, and Mermaid diagrams where relevant.]

### 🟣 Deep Technical & Implementation
[Provide deep code-level walkthrough, exact function mechanics, citations to [file:startLine-endLine], edge cases, and performance/security implications with code blocks.]
`;

    let lastError: any = null;
    for (const modelToUse of modelsToTry) {
      try {
        const model = client.getGenerativeModel({
          model: modelToUse,
          generationConfig: { temperature: 0.3 },
        });

        const result = await model.generateContentStream(prompt);
        let fullText = '';
        for await (const chunk of result.stream) {
          const text = chunk.text();
          fullText += text;
          onChunk(text);
        }

        if (fullText.trim().length > 0) {
          return {
            question,
            answer: fullText,
            citations,
            modelUsed: modelToUse,
            answeredAt: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Streaming with model ${modelToUse} failed: ${sanitizeError(err)}. Trying fallback...`);
      }
    }

    throw new Error(`Gemini Streaming Error: ${sanitizeError(lastError)}`);
  }
}
