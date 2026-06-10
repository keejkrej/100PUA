export * from './config';
export * from './constants';
export * from './errors';
export * from './explain-agent';
export * from './explain-cache';
export * from './explain-service';
export * from './github';
export * from './project-root';
export * from './prompt-index';
export * from './rate-limit';
export * from './schemas';
export * from './suggestion-service';
export * from './topics';

export * from './script-helpers';

import { Layer } from 'effect';

import { AppConfig } from './config';
import { ExplainAgentService } from './explain-agent';
import { ExplainCacheService } from './explain-cache';
import { GithubHttpClientLive, GithubIssuesService } from './github';
import { ProjectRootLive } from './project-root';
import { PromptIndexService } from './prompt-index';
import { RateLimitService } from './rate-limit';

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
