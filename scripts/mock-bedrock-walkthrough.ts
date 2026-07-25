import { BedrockClient } from '../packages/ai-generator/src/bedrock.js';

async function main(): Promise<void> {
  if (process.env.CITY_COMMANDER_ENV !== 'LOCAL_MOCK') {
    throw new Error('Mock walkthrough requires CITY_COMMANDER_ENV=LOCAL_MOCK');
  }

  const client = new BedrockClient({ region: 'local-mock', modelId: 'mock-text-generator' });
  const output = await client.generateText(
    'LOCAL_MOCK Bedrock walkthrough: deterministic facts remain unchanged.',
  );

  if (!output.startsWith('[MOCK] LOCAL_MOCK Bedrock walkthrough')) {
    throw new Error('Mock Bedrock adapter did not produce the expected offline response');
  }

  console.log('Mock-Bedrock walkthrough passed with no AWS call.');
}

void main();
