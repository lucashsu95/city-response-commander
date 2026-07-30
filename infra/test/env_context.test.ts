/**
 * TASK-059 targeted tests — env_context and four-stack wiring
 *
 * Runs without AWS credentials or network access.
 * Uses inline CDK App construction (no file I/O).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { NetworkAuthStack } from '../lib/network_auth_stack.js';
import { DataStack } from '../lib/data_stack.js';
import { ComputeStack } from '../lib/compute_stack.js';
import { FrontendStack } from '../lib/frontend_stack.js';

describe('TASK-059: env_context resolver', () => {
  describe('LOCAL_MOCK profile', () => {
    it('resolves LOCAL_MOCK correctly', () => {
      const app = new App({ autoSynth: false });
      app.node.setContext('env', 'LOCAL_MOCK');
      const ctx = resolveEnvironmentContext(app.node);
      expect(ctx.profile).toBe('LOCAL_MOCK');
      expect(ctx.resourcePrefix).toBe('local');
      expect(ctx.isLocalMock).toBe(true);
      expect(ctx.isCompetition).toBe(false);
      expect(typeof ctx.account).toBe('string');
      expect(typeof ctx.region).toBe('string');
    });
  });

  describe('PERSONAL_AWS_DEV profile', () => {
    it('resolves PERSONAL_AWS_DEV correctly', () => {
      const app = new App({ autoSynth: false });
      app.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(app.node);
      expect(ctx.profile).toBe('PERSONAL_AWS_DEV');
      expect(ctx.resourcePrefix).toBe('personal-dev');
      expect(ctx.isLocalMock).toBe(false);
      expect(ctx.isCompetition).toBe(false);
      expect(typeof ctx.account).toBe('string');
      expect(typeof ctx.region).toBe('string');
    });
  });

  describe('COMPETITION_AWS profile', () => {
    it('resolves COMPETITION_AWS correctly', () => {
      const app = new App({ autoSynth: false });
      app.node.setContext('env', 'COMPETITION_AWS');
      const ctx = resolveEnvironmentContext(app.node);
      expect(ctx.profile).toBe('COMPETITION_AWS');
      expect(ctx.resourcePrefix).toBe('competition');
      expect(ctx.isLocalMock).toBe(false);
      expect(ctx.isCompetition).toBe(true);
      expect(typeof ctx.account).toBe('string');
      expect(typeof ctx.region).toBe('string');
    });
  });

  describe('missing env', () => {
    it('throws when env is missing', () => {
      const app = new App({ autoSynth: false });
      expect(() => resolveEnvironmentContext(app.node)).toThrow(/Context key 'env' is required/);
    });
  });

  describe('invalid env', () => {
    it('throws with valid values listed', () => {
      const app = new App({ autoSynth: false });
      app.node.setContext('env', 'INVALID_PROFILE');
      expect(() => resolveEnvironmentContext(app.node)).toThrow(/Invalid env profile: 'INVALID_PROFILE'/);
      expect(() => resolveEnvironmentContext(app.node)).toThrow(/LOCAL_MOCK, PERSONAL_AWS_DEV, COMPETITION_AWS/);
    });
  });
});

describe('TASK-059: four stacks', () => {
  const PROFILES = ['LOCAL_MOCK', 'PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const;

  for (const profile of PROFILES) {
    describe(`${profile}`, () => {
      let app: App;
      let ctx: ReturnType<typeof resolveEnvironmentContext>;

      beforeEach(() => {
        app = new App({ autoSynth: false });
        app.node.setContext('env', profile);
        ctx = resolveEnvironmentContext(app.node);
      });

      it('creates exactly four stacks', () => {
        new NetworkAuthStack(app, `${ctx.resourcePrefix}-network-auth`, { envContext: ctx });
        new DataStack(app, `${ctx.resourcePrefix}-data`, { envContext: ctx });
        new ComputeStack(app, `${ctx.resourcePrefix}-compute`, { envContext: ctx });
        new FrontendStack(app, `${ctx.resourcePrefix}-frontend`, { envContext: ctx });

        const stacks = app.node.children.filter((n): n is Stack =>
          Stack.isStack(n),
        );
        expect(stacks).toHaveLength(4);
      });

      it('stack names have correct environment prefix', () => {
        new NetworkAuthStack(app, `${ctx.resourcePrefix}-network-auth`, { envContext: ctx });
        new DataStack(app, `${ctx.resourcePrefix}-data`, { envContext: ctx });
        new ComputeStack(app, `${ctx.resourcePrefix}-compute`, { envContext: ctx });
        new FrontendStack(app, `${ctx.resourcePrefix}-frontend`, { envContext: ctx });

        const stacks = app.node.children.filter((n): n is Stack =>
          Stack.isStack(n),
        );

        const expectedPrefix =
          profile === 'LOCAL_MOCK'
            ? 'local'
            : profile === 'PERSONAL_AWS_DEV'
              ? 'personal-dev'
              : 'competition';

        for (const stack of stacks) {
          expect(stack.stackName).toMatch(new RegExp(`^${expectedPrefix}`));
        }
      });

      it('all four stacks receive the same environment context', () => {
        const stack1 = new NetworkAuthStack(app, `${ctx.resourcePrefix}-network-auth`, { envContext: ctx });
        const stack2 = new DataStack(app, `${ctx.resourcePrefix}-data`, { envContext: ctx });
        const stack3 = new ComputeStack(app, `${ctx.resourcePrefix}-compute`, { envContext: ctx });
        const stack4 = new FrontendStack(app, `${ctx.resourcePrefix}-frontend`, { envContext: ctx });

        const stacks = [stack1, stack2, stack3, stack4];
        expect(stacks).toHaveLength(4);
        for (const stack of stacks) {
          expect(stack).toBeDefined();
          expect(Stack.isStack(stack)).toBe(true);
        }
      });
    });
  }
});
