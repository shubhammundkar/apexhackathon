import { describe, it, expect } from 'vitest';
import {
  queryRelevanceService,
  REJECTION_MESSAGE,
} from '../src/services/queryRelevanceService.js';

describe('Query Relevance Gate Service', () => {
  const dummyMetadata: any = {
    id: 'test/repo',
    owner: 'test',
    name: 'repo',
    fullName: 'test/repo',
    url: 'https://github.com/test/repo',
    defaultBranch: 'main',
    description: 'An AI developer tool',
    stars: 10,
    forks: 2,
    openIssues: 0,
    primaryLanguage: 'TypeScript',
    license: 'MIT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sizeKb: 100,
  };

  const sampleFilePaths = [
    'src/index.ts',
    'src/services/authService.ts',
    'src/routes/api.ts',
    'package.json',
    'README.md',
  ];

  describe('Irrelevant Query Rejection', () => {
    const irrelevantQueries = [
      'Where is KFC near me?',
      'Can you find McDonald\'s nearby?',
      'What\'s the weather today in New York?',
      'Will it rain tomorrow?',
      'Tell me a joke',
      'Make me laugh with a funny pun',
      'Write me a love letter',
      'Who was Napoleon?',
      'Who is the president of France?',
      'How to bake a chocolate cake',
      'Recipe for pasta carbonara',
      'Who won the football world cup?',
      'What is my horoscope for today?',
      'Where is the nearest gas station?',
      'What are the symptoms of flu?',
      'Buy cheap shoes online',
    ];

    it.each(irrelevantQueries)('rejects: "%s"', (question) => {
      const res = queryRelevanceService.classify({
        question,
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(false);
      expect(['unrelated_irrelevant', 'ambiguous_fallback']).toContain(res.reason);
    });

    it('provides the exact expected rejection message', () => {
      expect(REJECTION_MESSAGE).toBe(
        "I'm designed to help you understand and analyze the current codebase. Please ask a question about its code, architecture, dependencies, bugs, or implementation."
      );
    });
  });

  describe('Relevant Codebase Query Acceptance', () => {
    const relevantQueries = [
      'How does the architecture work?',
      'What is the purpose of this project?',
      'Explain how authentication works',
      'Where is the entry point of the app?',
      'Are there any security vulnerabilities or SQL injection risks?',
      'What are the dependencies in this codebase?',
      'How is MongoDB connected?',
      'How does data flow from frontend to backend?',
      'Explain the error handling in api routes',
      'How do I run and test this repo?',
      'Explain index.ts',
      'What does parseRepository do?',
      'Show me the database schema',
    ];

    it.each(relevantQueries)('accepts: "%s"', (question) => {
      const res = queryRelevanceService.classify({
        question,
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
      expect(['valid_code_intent', 'repo_entity_match']).toContain(res.reason);
    });
  });

  describe('Short Conversational Follow-up Handling', () => {
    const followUps = [
      'Why?',
      'Why is that?',
      'How so?',
      'What happens next?',
      'Can you simplify?',
      'Can you elaborate?',
      'Give an example',
      'Show me code',
      'What else?',
      'Where is it defined?',
      'Which file?',
      'Continue',
      'Explain this',
      'Tell me more',
      'How to fix it?',
    ];

    it.each(followUps)('accepts follow-up: "%s"', (question) => {
      const res = queryRelevanceService.classify({
        question,
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
      expect(['conversational_follow_up', 'valid_code_intent']).toContain(res.reason);
    });
  });

  describe('File-Scoped Queries', () => {
    it('accepts question when scoped to an active file', () => {
      const res = queryRelevanceService.classify({
        question: 'What does this do?',
        filePath: 'src/services/authService.ts',
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
      expect(['file_path_scoped', 'valid_code_intent']).toContain(res.reason);
    });

    it('accepts line review when scoped to an active file', () => {
      const res = queryRelevanceService.classify({
        question: 'Is line 20 safe?',
        filePath: 'src/routes/api.ts',
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
      expect(['file_path_scoped', 'valid_code_intent']).toContain(res.reason);
    });
  });

  describe('Repo Entity and Syntax Matching', () => {
    it('accepts question referencing repo file name', () => {
      const res = queryRelevanceService.classify({
        question: 'What is inside authService?',
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
    });

    it('accepts question with camelCase function identifiers', () => {
      const res = queryRelevanceService.classify({
        question: 'How does verifyToken work?',
        repoMetadata: dummyMetadata,
        allFilePaths: sampleFilePaths,
      });

      expect(res.isRelevant).toBe(true);
    });
  });
});
