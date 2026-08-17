/**
 * 【功能描述】
 * 通过 Supabase REST API 的 exec_sql RPC 远程执行本地 SQL 文件（默认 create_questions_tables.sql）。
 *
 * 【业务逻辑】
 * 1. 读取 sql/create_questions_tables.sql 文件内容
 * 2. 向 Supabase /rest/v1/rpc/exec_sql 发送 POST 请求执行 DDL
 * 3. 根据 HTTP 状态码输出成功或失败提示
 *
 * 【技术实现】
 * - 涉及方法：fs.readFileSync、https.request、dotenv
 * - 涉及知识点：Supabase Service Role Key 鉴权、RPC 远程 SQL 执行
 *
 * 用法：node execute-sql.js
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

// 读取 SQL 文件
const sqlPath = path.join(__dirname, 'sql', 'create_questions_tables.sql');
const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

console.log('=== 执行 SQL 创建表 ===\n');
console.log('SQL 文件:', sqlPath);
console.log('Supabase URL:', process.env.SUPABASE_URL);

// 使用 Supabase REST API 执行 SQL
const url = new URL('/rest/v1/rpc/exec_sql', process.env.SUPABASE_URL);

const postData = JSON.stringify({
  sql: sqlContent
});

const options = {
  hostname: url.hostname,
  port: 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Length': Buffer.byteLength(postData),
    'Prefer': 'return=minimal'
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201 || res.statusCode === 204) {
      console.log('\n✓ SQL 执行成功！');
      console.log('响应状态:', res.statusCode);
    } else {
      console.log('\n× SQL 执行失败');
      console.log('响应状态:', res.statusCode);
      console.log('响应内容:', data);
      console.log('\n注意: 如果 exec_sql RPC 不存在，请手动在 Supabase Dashboard 中执行 SQL');
    }
  });
});

req.on('error', (error) => {
  console.error('\n× 请求错误:', error.message);
  console.error('\n请手动在 Supabase Dashboard > SQL Editor 中执行以下文件:');
  console.error(sqlPath);
});

req.write(postData);
req.end();

console.log('正在执行 SQL...');
