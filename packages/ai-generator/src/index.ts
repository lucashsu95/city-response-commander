/**
 * Bedrock AI 文字生成整合
 *
 * 封裝 Amazon Bedrock API 調用，負責：
 * - 決策建議書生成（含揭露區塊）
 * - 多語通報生成（中英日韓）
 * - What-if 意圖理解
 * - 決策解釋生成
 *
 * @module ai-generator
 */

export { BedrockClient } from './bedrock.js';
export { RecommendationGenerator } from './recommendation-generator.js';
export { MultilingualGenerator } from './multilingual-generator.js';
