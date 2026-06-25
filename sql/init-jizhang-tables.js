/**
 * 记账模块建表说明脚本（需在 Supabase SQL Editor 手动执行 SQL）
 * 运行: node sql/init-jizhang-tables.js
 */
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, 'create-jizhang-tables.sql');

console.log('='.repeat(60));
console.log('记账本 (jizhang) 数据库初始化');
console.log('='.repeat(60));
console.log('\n请在 Supabase Dashboard → SQL Editor 中执行以下文件内容：\n');
console.log(sqlPath);
console.log('\n--- SQL 预览（前 500 字符）---\n');
console.log(fs.readFileSync(sqlPath, 'utf8').slice(0, 500));
console.log('\n...\n');
console.log('执行完成后，重启后端: npm run dev');
console.log('\n邮箱登录配置：');
console.log('1. Supabase → Authentication → Providers → Email → 开启');
console.log('2. 推荐开启 Email OTP（6位验证码）');
console.log('3. .env 配置 SUPABASE_SERVICE_ROLE_KEY（本地验证码回退登录需要）');
console.log('='.repeat(60));
