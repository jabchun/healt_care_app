// Netlify 빌드 시 환경 변수로 config.js 자동 생성
const fs = require('fs');

const key   = process.env.OPENROUTER_API_KEY || '';
const model = process.env.CLAUDE_MODEL || 'google/gemini-2.0-flash-001';

if (!key) {
  console.error('ERROR: OPENROUTER_API_KEY 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const content = `const CONFIG = {
  OPENROUTER_API_KEY: "${key}",
  BASE_URL: "https://openrouter.ai/api/v1",
  CLAUDE_MODEL: "${model}",
};
`;

fs.writeFileSync('config.js', content);
console.log('✅ config.js 생성 완료 (model:', model, ')');
