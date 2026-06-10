export * from './config.js';
export * from './constants.js';
export * from './errors.js';
export * from './explain-agent.js';
export * from './explain-cache.js';
export * from './explain-service.js';
export * from './github.js';
export * from './project-root.js';
export * from './prompt-index.js';
export * from './rate-limit.js';
export * from './schemas.js';
export * from './suggestion-service.js';
export * from './topics.js';

export * from './script-helpers.js';

import { Layer } from 'effect';

import { AppConfig } from './config.js';
import { ExplainAgentService } from './explain-agent.js';
import { ExplainCacheService } from './explain-cache.js';
import { GithubHttpClientLive, GithubIssuesService } from './github.js';
import { ProjectRootLive } from './project-root.js';
import { PromptIndexService } from './prompt-index.js';
import { RateLimitService } from './rate-limit.js';

export const DomainLive = Layer.mergeAll(
  ProjectRootLive,
  AppConfig.Live,
  PromptIndexService.Live,
  ExplainCacheService.Live,
  ExplainAgentService.Live,
  RateLimitService.Live,
  GithubHttpClientLive,
  GithubIssuesService.Live,
);
