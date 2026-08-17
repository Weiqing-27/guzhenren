const express = require("express");
const bcrypt = require("bcrypt");
const { generateToken } = require("../utils/jwt");

const router = express.Router();

/**
 * 【功能描述】
 * 用户注册：校验用户名唯一性、加密密码、写入 users 表，并签发 JWT。
 *
 * 【业务逻辑】
 * 1. 校验 username、password 非空；
 * 2. 查询 users 表是否已有同名用户 → 已存在则 400；
 * 3. 校验密码为字符串且长度 ≥ 6；
 * 4. bcrypt 哈希密码（saltRounds=10），插入用户（默认 role=user，随机字母头像）；
 * 5. 用新用户 user_id / username / role 生成 JWT；
 * 6. 返回 201 及 userId、username、avatar_url、role、token。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select()/insert()、bcrypt.hash()、generateToken()、String.charAt()/toUpperCase()
 * - 涉及知识点：密码不可逆哈希（bcrypt）、盐轮次、JWT 登录态签发、Supabase/PostgREST 查询与插入、默认角色与头像生成
 */
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入数据
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  try {
    // 检查用户名是否存在
    const { data: existingUser, error: selectError } = await supabase
      .from("users")
      .select("username")
      .eq("username", username);

    if (selectError) {
      console.error("Supabase查询错误:", selectError);
      return res.status(500).json({ error: "数据库查询错误" });
    }

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: "用户名已存在" });
    }

    // 密码加密
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "密码必须是至少6个字符的字符串" });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 创建用户，包含默认头像和角色
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert([
        {
          username,
          password_hash: passwordHash,
          avatar_url: 'https://ui-avatars.com/api/?name=' + username.charAt(0).toUpperCase() + '&background=random',
          role: 'user' // 默认角色为普通用户
        },
      ])
      .select();

    if (insertError) {
      console.error("用户创建错误:", insertError);
      return res.status(500).json({ error: "用户创建失败" });
    }

    // 生成JWT token
    const token = generateToken({
      userId: newUser[0].user_id,
      username: newUser[0].username,
      role: newUser[0].role
    });

    res.status(201).json({
      code: 201,
      message: "注册成功",
      data: {
        userId: newUser[0].user_id,
        username: newUser[0].username,
        avatar_url: newUser[0].avatar_url,
        role: newUser[0].role,
        token: token
      }
    });
  } catch (error) {
    console.error("注册错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 用户登录：按用户名查库、比对密码哈希，成功后签发 JWT。
 *
 * 【业务逻辑】
 * 1. 校验 username、password 非空；
 * 2. 按 username 查询 users（含 password_hash、avatar_url、role）；
 * 3. 无用户 → 401「该用户不存在」；
 * 4. bcrypt.compare 校验密码；失败 → 401「用户名或密码错误」；
 * 5. 签发 JWT（payload：userId / username / role）；
 * 6. 返回 200 及用户信息与 token（不含 password_hash）。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq()、bcrypt.compare()、generateToken()
 * - 涉及知识点：凭证核验、恒定时间倾向的哈希比对（bcrypt）、JWT 会话、敏感字段不回传
 */
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入
  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  try {
    // 查询用户（包含头像和角色信息）
    const { data: users, error } = await supabase
      .from("users")
      .select("user_id, username, password_hash, avatar_url, role")
      .eq("username", username);

    if (error) {
      console.error("登录查询错误:", error);
      return res.status(500).json({ error: "数据库查询错误" });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ error: "该用户不存在！" });
    }

    const user = users[0];

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "用户名或密码错误" });
    }

    // 生成JWT token
    const token = generateToken({
      userId: user.user_id,
      username: user.username,
      role: user.role
    });

    res.status(200).json({
      code: 200,
      message: "登录成功",
      data: {
        userId: user.user_id,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        token: token
      },
    });
  } catch (error) {
    console.error("登录错误:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 修改密码：校验旧密码与两次新密码一致后，更新 users.password_hash。
 *
 * 【业务逻辑】
 * 1. 校验 userId、old_password、new_password、confirm_password 均非空；
 * 2. 新密码与确认密码必须一致；
 * 3. 新密码长度 ≥ 6；
 * 4. 按 user_id 查 password_hash；用户不存在 → 404；
 * 5. bcrypt 校验旧密码；错误 → 400；
 * 6. 哈希新密码并 update；失败 → 500；成功 → 200「密码修改成功」。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().single() / .update().eq()、bcrypt.compare()、bcrypt.hash()
 * - 涉及知识点：改密流程（旧密校验 + 新密确认）、单行查询 .single()、密码轮换后旧 token 仍可能有效（本接口未做强制登出）
 */
router.post("/password/change", async (req, res) => {
  const { userId, old_password, new_password, confirm_password } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入
  if (!userId || !old_password || !new_password || !confirm_password) {
    return res.status(400).json({
      code: 400,
      message: "用户ID、当前密码、新密码和确认密码都不能为空"
    });
  }

  // 验证密码一致性
  if (new_password !== confirm_password) {
    return res.status(400).json({
      code: 400,
      message: "新密码和确认密码不一致"
    });
  }

  // 验证新密码强度
  if (new_password.length < 6) {
    return res.status(400).json({
      code: 400,
      message: "新密码长度至少6位"
    });
  }

  try {
    // 查询用户当前信息
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("password_hash")
      .eq("user_id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        code: 404,
        message: "用户不存在"
      });
    }

    // 验证旧密码
    const oldPasswordMatch = await bcrypt.compare(old_password, user.password_hash);
    if (!oldPasswordMatch) {
      return res.status(400).json({
        code: 400,
        message: "当前密码错误"
      });
    }

    // 加密新密码
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(new_password, saltRounds);

    // 更新密码
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: newPasswordHash })
      .eq("user_id", userId);

    if (updateError) {
      console.error("更新密码错误:", updateError);
      return res.status(500).json({
        code: 500,
        message: "密码更新失败",
        error: updateError.message
      });
    }

    res.status(200).json({
      code: 200,
      message: "密码修改成功"
    });
  } catch (error) {
    console.error("修改密码异常:", error.message);
    res.status(500).json({
      code: 500,
      message: "服务器错误",
      error: error.message
    });
  }
});

/**
 * 【功能描述】
 * 更新用户头像 URL，并返回更新后的用户基础字段。
 *
 * 【业务逻辑】
 * 1. 校验 userId、avatarUrl 非空；
 * 2. 按 user_id 更新 avatar_url，并 select 回传 user_id / username / avatar_url / role；
 * 3. 更新失败 → 500；无匹配行 → 404；成功 → 200 + data。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().update().eq().select()
 * - 涉及知识点：资源局部更新（PUT）、按主键更新后回读、Express 路由 body 入参
 */
router.put("/avatar", async (req, res) => {
  const { userId, avatarUrl } = req.body;
  const supabase = req.app.get('supabase');

  // 验证输入
  if (!userId || !avatarUrl) {
    return res.status(400).json({ error: "用户ID和头像URL不能为空" });
  }

  try {
    // 更新用户头像
    const { data, error } = await supabase
      .from("users")
      .update({ avatar_url: avatarUrl })
      .eq("user_id", userId)
      .select("user_id, username, avatar_url, role");

    if (error) {
      console.error("更新头像错误:", error);
      return res.status(500).json({ error: "更新头像失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "头像更新成功",
      data: data[0]
    });
  } catch (error) {
    console.error("更新头像异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

/**
 * 【功能描述】
 * 按 userId 查询公开用户资料（不含密码哈希）。
 *
 * 【业务逻辑】
 * 1. 从路径参数读取 userId；
 * 2. 查询 user_id / username / avatar_url / role / created_at；
 * 3. 查询失败 → 500；无数据 → 404；成功 → 200 + data。
 *
 * 【技术实现】
 * - 涉及方法：supabase.from().select().eq()、req.params
 * - 涉及知识点：RESTful 资源读取、路径参数、敏感字段排除（不 select password_hash）
 */
router.get("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const supabase = req.app.get('supabase');

  try {
    // 查询用户信息
    const { data, error } = await supabase
      .from("users")
      .select("user_id, username, avatar_url, role, created_at")
      .eq("user_id", userId);

    if (error) {
      console.error("获取用户信息错误:", error);
      return res.status(500).json({ error: "获取用户信息失败" });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.status(200).json({
      code: 200,
      message: "获取用户信息成功",
      data: data[0]
    });
  } catch (error) {
    console.error("获取用户信息异常:", error.message);
    res.status(500).json({ error: "服务器错误", details: error.message });
  }
});

module.exports = router;
