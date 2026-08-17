/**
 * 【功能描述】
 * 软考复习模块建表指引脚本，提示在 Supabase SQL Editor 执行 create-ruankao-tables.sql。
 *
 * 【业务逻辑】
 * 1. 读取 create-ruankao-tables.sql 并统计字符长度
 * 2. 输出 Dashboard 操作步骤及将创建的表清单
 *
 * 【技术实现】
 * - 涉及方法：fs.readFileSync、path.join
 * - 涉及知识点：Supabase JS 无法直接执行 DDL，需 SQL Editor 手动执行
 *
 * 用法：node sql/init-ruankao.js
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
