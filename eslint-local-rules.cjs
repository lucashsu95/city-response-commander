'use strict';

/**
 * Local ESLint rules for the city-response-commander project.
 *
 * Custom rule: no-llm-prohibited-field-write
 * Flags writes to LLM-prohibited DecisionCore fields from renderer/rag modules (§9 boundary).
 *
 * LLM_PROHIBITED_FIELDS below is a manual copy of the canonical list in
 * packages/shared-schemas/src/llm_boundary.ts. This file is a repo-root,
 * lint-time CJS module outside any package's build output, so it can't
 * import that ESM package without a build step; instead,
 * eslint-local-rules/test/prohibited-fields-sync.test.ts asserts the two
 * lists stay identical. Update both when DecisionCore's fields change.
 */

const LLM_PROHIBITED_FIELDS = new Set([
  'decision_id',
  'idempotency_key',
  'core_hash',
  'source_manifest_hash',
  'immutable_after_commit',
  'event_id',
  'occurred_at',
  'event_facts',
  'triggered_articles',
  'applied_formula_articles',
  'invoked_procedures',
  'art1_measures',
  'classifications',
  'incident_anchor',
  'primary_evacuation',
  'secondary_evacuation',
  'excluded_candidates',
  'affected_intersection_scope',
  'ete',
  'multilingual_required',
  'multilingual_scope',
  'evidence',
  'policy',
  'cms_core_text',
  'provisional',
  'schema_version',
]);

function memberFieldName(member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }
  return undefined;
}

module.exports = {
  'no-llm-prohibited-field-write': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'Disallow writes to LLM-prohibited core fields from renderer/rag modules (§9 boundary)',
        category: 'Possible Errors',
      },
      schema: [],
      messages: {
        noProhibitedWrite:
          'LLM-prohibited: renderer/rag modules must not write to "{{field}}" — this is a core field owned by the deterministic engine (§9 boundary).',
      },
    },
    create(context) {
      const filename = context.getFilename().replace(/\\/g, '/');
      const isRendererOrRag =
        filename.includes('/packages/rag/') || filename.includes('/packages/ai-generator/');

      if (!isRendererOrRag) {
        return {};
      }

      function reportMemberWrite(node, member) {
        const field = memberFieldName(member);
        if (field && LLM_PROHIBITED_FIELDS.has(field)) {
          context.report({ node, messageId: 'noProhibitedWrite', data: { field } });
        }
      }

      return {
        AssignmentExpression(node) {
          if (node.left.type === 'MemberExpression') {
            reportMemberWrite(node, node.left);
          }
        },
        UpdateExpression(node) {
          if (node.argument.type === 'MemberExpression') {
            reportMemberWrite(node, node.argument);
          }
        },
      };
    },
  },
};

// NOTE: eslint-plugin-local-rules treats every key of `module.exports` above
// as a rule name (Object.keys(rules) → `local-rules/<key>`), so this constant
// must not be attached to that same object. It's exposed as a non-enumerable
// property instead, purely for eslint-local-rules/test/prohibited-fields-sync.test.ts
// to read at test time.
Object.defineProperty(module.exports, 'LLM_PROHIBITED_FIELDS', {
  value: LLM_PROHIBITED_FIELDS,
  enumerable: false,
});
