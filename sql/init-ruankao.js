/**
 * 软考模块建表指引
 * 用法：node sql/init-ruankao.js
 *
 * Supabase JS 无法直接执行任意 DDL，请在 Dashboard → SQL Editor
 * 粘贴执行 create-ruankao-tables.sql
 */
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, 'create-ruankao-tables.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log('========================================');
console.log('软考复习模块 · 数据库初始化');
console.log('========================================');
console.log('1. 打开 Supabase Dashboard → SQL Editor');
console.log('2. 粘贴并执行文件内容：');
console.log(`   ${sqlPath}`);
console.log('3. 成功后前端 /ruankao 即可刷题、打卡、记笔记');
console.log('----------------------------------------');
console.log(`SQL 长度: ${sql.length} 字符`);
console.log('表: ruankao_questions / attempts / wrong_book / checkins / notes / knowledge');
console.log('========================================');
